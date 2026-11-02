import { deleteUserDocument, getUserDocument, ingestDocument, listUserDocuments } from '../services/documentService.js';

export async function listDocuments(req, res, next) {
  try {
    const documents = await listUserDocuments(req.user._id);
    res.json({ status: 'ok', documents });
  } catch (error) { next(error); }
}

export async function uploadDocument(req, res, next) {
  try {
    const result = await ingestDocument({ userId: req.user._id, file: req.file });
    const document = result.document;
    res.status(result.alreadyProcessed ? 200 : 201).json({
      status: 'ok',
      alreadyProcessed: result.alreadyProcessed,
      document: {
        id: document._id,
        name: document.name,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        status: document.status,
        chunkCount: document.chunkCount,
        pageCount: document.pageCount,
        pageReferenceType: document.pageReferenceType,
        createdAt: document.createdAt,
      },
    });
  } catch (error) { next(error); }
}

export async function viewDocument(req, res, next) {
  try {
    const result = await getUserDocument(req.user._id, req.params.id);
    if (!result) return res.status(404).json({ status: 'error', message: 'Document not found.' });
    res.json({
      status: 'ok',
      document: {
        id: result.document._id,
        name: result.document.name,
        mimeType: result.document.mimeType,
        sizeBytes: result.document.sizeBytes,
        status: result.document.status,
        chunkCount: result.document.chunkCount,
        pageCount: result.document.pageCount,
        pageReferenceType: result.document.pageReferenceType,
        createdAt: result.document.createdAt,
      },
      chunks: result.chunks,
    });
  } catch (error) { next(error); }
}

export async function removeDocument(req, res, next) {
  try {
    const removed = await deleteUserDocument(req.user._id, req.params.id);
    if (!removed) return res.status(404).json({ status: 'error', message: 'Document not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
}
