import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 255 },
  mimeType: { type: String, required: true, enum: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  sizeBytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing', index: true },
  chunkCount: { type: Number, default: 0 },
  pageCount: { type: Number, default: 0 },
  pageReferenceType: { type: String, enum: ['pdf', 'estimated'], required: true },
  embeddingModel: { type: String, required: true },
  errorMessage: { type: String, select: false },
}, { timestamps: true });

documentSchema.index({ user: 1, sha256: 1 }, { unique: true });
documentSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('Document', documentSchema);
