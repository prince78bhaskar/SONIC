import mongoose from 'mongoose';
import Document from '../models/Document.js';
import DocumentChunk from '../models/DocumentChunk.js';
import { embeddingModelName } from './documentService.js';
import { generateEmbeddings } from './llmProvider.js';

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function retrieveRelevantChunks({ userId, query, documentIds, topK = 6, allChunks = false }) {
  const model = embeddingModelName();
  if (Array.isArray(documentIds) && documentIds.length === 0) return { documentsAvailable: false, selectionEmpty: true, chunks: [], sources: [] };
  const filter = { user: userId, status: 'ready', embeddingModel: model };
  if (Array.isArray(documentIds)) {
    const validIds = documentIds.filter((id) => mongoose.isValidObjectId(id));
    if (!validIds.length) return { documentsAvailable: false, selectionEmpty: false, chunks: [], sources: [] };
    filter._id = { $in: validIds };
  }
  const documents = await Document.find(filter).select('_id name pageReferenceType').lean();
  if (!documents.length) return { documentsAvailable: false, selectionEmpty: false, chunks: [], sources: [] };

  const documentNames = new Map(documents.map((document) => [String(document._id), document.name]));
  const chunkFilter = {
    user: userId,
    document: { $in: documents.map((document) => document._id) },
    embeddingModel: model,
  };
  const totalChunkCount = allChunks ? await DocumentChunk.countDocuments(chunkFilter) : 0;
  const maxChunks = 60;
  const queryVector = allChunks ? null : (await generateEmbeddings([query]))[0];
  const cursor = DocumentChunk.find(chunkFilter)
    .sort(allChunks ? { document: 1, chunkIndex: 1 } : {})
    .select('+embedding document text pageNumbers pageReferenceType chunkIndex')
    .lean()
    .cursor();

  const best = [];
  const minimumScore = Number(process.env.RAG_MIN_SIMILARITY || 0.22);
  for await (const chunk of cursor) {
    const score = allChunks ? null : cosineSimilarity(queryVector, chunk.embedding);
    if (!allChunks && score < minimumScore) continue;
    best.push({
      documentId: String(chunk.document),
      documentName: documentNames.get(String(chunk.document)) || 'Uploaded document',
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      pageNumbers: chunk.pageNumbers,
      pageReferenceType: chunk.pageReferenceType,
      score,
    });
    if (allChunks && best.length >= maxChunks) break;
    if (!allChunks) {
      best.sort((left, right) => right.score - left.score);
      if (best.length > topK) best.pop();
    }
  }
  await cursor.close();
  if (allChunks) best.sort((left, right) => left.documentId.localeCompare(right.documentId) || left.chunkIndex - right.chunkIndex);

  const sourceMap = new Map();
  for (const chunk of best) {
    const source = sourceMap.get(chunk.documentId) || {
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      pageNumbers: new Set(),
      pageReferenceType: chunk.pageReferenceType,
    };
    chunk.pageNumbers.forEach((page) => source.pageNumbers.add(page));
    sourceMap.set(chunk.documentId, source);
  }
  const sources = [...sourceMap.values()].map((source) => ({
    documentId: source.documentId,
    documentName: source.documentName,
    pageNumbers: [...source.pageNumbers].sort((a, b) => a - b),
    pageReferenceType: source.pageReferenceType,
  }));
  return { documentsAvailable: true, chunks: best, sources, truncated: allChunks && totalChunkCount > best.length, totalChunkCount };
}

export function formatRetrievedContext(chunks) {
  return chunks.map((chunk, index) => {
    const pageLabel = chunk.pageNumbers.map((page) => `${chunk.pageReferenceType === 'estimated' ? '~' : ''}${page}`).join(', ');
    return `[Excerpt ${index + 1} | Document: ${chunk.documentName} | Page${chunk.pageNumbers.length === 1 ? '' : 's'}: ${pageLabel}]\n${chunk.text}`;
  }).join('\n\n---\n\n');
}
