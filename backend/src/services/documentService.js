import { createHash } from 'node:crypto';
import Document from '../models/Document.js';
import DocumentChunk from '../models/DocumentChunk.js';
import { chunkDocumentPages, extractDocumentPages } from './documentTextService.js';
import { generateEmbeddings } from './llmProvider.js';

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const EMBEDDING_BATCH_SIZE = 64;
const EXTENSION_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function embeddingModelName() {
  return process.env.EMBEDDING_MODEL || 'nomic-embed-text:latest';
}

export function validateUploadedFile(file) {
  if (!file) {
    const error = new Error('Choose a PDF or DOCX document to upload.');
    error.statusCode = 400;
    throw error;
  }
  const extension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  const mimeType = EXTENSION_TYPES[extension];
  if (!mimeType) {
    const error = new Error('Only PDF and DOCX documents are supported.');
    error.statusCode = 415;
    throw error;
  }
  if (mimeType === 'application/pdf' && file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    const error = new Error('The uploaded file does not appear to be a valid PDF.');
    error.statusCode = 400;
    throw error;
  }
  if (mimeType.endsWith('wordprocessingml.document') && file.buffer.subarray(0, 2).toString() !== 'PK') {
    const error = new Error('The uploaded file does not appear to be a valid DOCX document.');
    error.statusCode = 400;
    throw error;
  }
  const safeName = file.originalname.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f]/g, '').slice(0, 255);
  return { mimeType, name: safeName || `document${extension}` };
}

export async function ingestDocument({ userId, file }) {
  const { mimeType, name } = validateUploadedFile(file);
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const model = embeddingModelName();
  let document = await Document.findOne({ user: userId, sha256 });

  if (document?.status === 'processing') {
    const error = new Error('This document is already being processed.');
    error.statusCode = 409;
    throw error;
  }
  if (document?.status === 'ready' && document.embeddingModel === model) {
    return { document, alreadyProcessed: true };
  }

  if (!document) {
    document = new Document({
      user: userId, name, mimeType, sizeBytes: file.size, sha256,
      pageReferenceType: mimeType === 'application/pdf' ? 'pdf' : 'estimated',
      embeddingModel: model, status: 'processing',
    });
    try {
      await document.save();
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await Document.findOne({ user: userId, sha256 });
      if (existing?.status === 'ready' && existing.embeddingModel === model) return { document: existing, alreadyProcessed: true };
      const conflict = new Error('This document is already being processed.');
      conflict.statusCode = 409;
      throw conflict;
    }
  } else {
    document.name = name;
    document.mimeType = mimeType;
    document.sizeBytes = file.size;
    document.pageReferenceType = mimeType === 'application/pdf' ? 'pdf' : 'estimated';
    document.embeddingModel = model;
    document.status = 'processing';
    document.errorMessage = undefined;
    await document.save();
  }

  try {
    await DocumentChunk.deleteMany({ user: userId, document: document._id });
    const extracted = await extractDocumentPages({ mimeType, buffer: file.buffer });
    const chunks = chunkDocumentPages(extracted.pages, extracted.pageReferenceType);
    if (!chunks.length) {
      const error = new Error('No readable text was found in this document.');
      error.statusCode = 422;
      throw error;
    }

    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const vectors = await generateEmbeddings(batch.map((chunk) => chunk.text));
      const rows = batch.map((chunk, index) => ({
        user: userId,
        document: document._id,
        chunkIndex: offset + index,
        text: chunk.text,
        pageNumbers: chunk.pageNumbers,
        pageReferenceType: chunk.pageReferenceType,
        embeddingModel: model,
        embedding: vectors[index],
      }));
      await DocumentChunk.insertMany(rows, { ordered: true });
    }

    document.status = 'ready';
    document.chunkCount = chunks.length;
    document.pageCount = extracted.pageCount;
    document.pageReferenceType = extracted.pageReferenceType;
    document.errorMessage = undefined;
    await document.save();
    return { document, alreadyProcessed: false };
  } catch (error) {
    await DocumentChunk.deleteMany({ user: userId, document: document._id });
    document.status = 'failed';
    document.chunkCount = 0;
    document.errorMessage = error.message;
    await document.save();
    throw error;
  }
}

export async function listUserDocuments(userId) {
  const documents = await Document.find({ user: userId }).sort({ createdAt: -1 }).lean();
  const currentModel = embeddingModelName();
  return documents.map((document) => ({
    id: document._id,
    name: document.name,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    chunkCount: document.chunkCount,
    pageCount: document.pageCount,
    pageReferenceType: document.pageReferenceType,
    createdAt: document.createdAt,
    needsReindex: document.status === 'ready' && document.embeddingModel !== currentModel,
  }));
}

export async function getUserDocument(userId, documentId) {
  const document = await Document.findOne({ _id: documentId, user: userId }).lean();
  if (!document) return null;
  const chunks = await DocumentChunk.find({ user: userId, document: document._id }).sort({ chunkIndex: 1 }).select('chunkIndex text pageNumbers pageReferenceType').lean();
  return { document, chunks };
}

export async function deleteUserDocument(userId, documentId) {
  const document = await Document.findOneAndDelete({ _id: documentId, user: userId });
  if (!document) return false;
  await DocumentChunk.deleteMany({ user: userId, document: document._id });
  return true;
}
