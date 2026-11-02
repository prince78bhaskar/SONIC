import mongoose from 'mongoose';

const documentChunkSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  chunkIndex: { type: Number, required: true },
  text: { type: String, required: true },
  pageNumbers: { type: [Number], required: true },
  pageReferenceType: { type: String, enum: ['pdf', 'estimated'], required: true },
  embeddingModel: { type: String, required: true },
  embedding: { type: [Number], required: true, select: false },
}, { timestamps: true });

documentChunkSchema.index({ document: 1, chunkIndex: 1 }, { unique: true });
documentChunkSchema.index({ user: 1, document: 1 });

export default mongoose.model('DocumentChunk', documentChunkSchema);
