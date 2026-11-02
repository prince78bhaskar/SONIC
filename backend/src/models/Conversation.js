import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, maxlength: 20000 },
  agentName: { type: String, maxlength: 80 },
  agentNames: { type: [String], default: [] },
  agentResults: [{
    agentName: { type: String, required: true, maxlength: 80 },
    content: { type: String, required: true, maxlength: 20000 },
  }],
  sources: [{
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    documentName: { type: String, required: true },
    pageNumbers: { type: [Number], default: [] },
    pageReferenceType: { type: String, enum: ['pdf', 'estimated'], required: true },
  }],
}, { timestamps: true });

const conversationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 100, default: 'New conversation' },
  hasCustomTitle: { type: Boolean, default: false },
  messages: { type: [messageSchema], default: [] },
}, { timestamps: true });

conversationSchema.index({ user: 1, updatedAt: -1 });

export default mongoose.model('Conversation', conversationSchema);
