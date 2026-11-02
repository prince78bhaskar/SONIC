import Conversation from '../models/Conversation.js';
import { createAssistantReply } from '../services/assistantService.js';

const ownerFilter = (req) => ({ _id: req.params.id, user: req.user._id });

export async function listConversations(req, res, next) {
  try {
    const conversations = await Conversation.find({ user: req.user._id })
      .select('title messages createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ status: 'ok', conversations: conversations.map((conversation) => ({
      id: conversation._id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
      preview: conversation.messages.at(-1)?.content || '',
    })) });
  } catch (error) { next(error); }
}

export async function createConversation(req, res, next) {
  try {
    const conversation = await Conversation.create({ user: req.user._id });
    res.status(201).json({ status: 'ok', conversation });
  } catch (error) { next(error); }
}

export async function getConversation(req, res, next) {
  try {
    const conversation = await Conversation.findOne(ownerFilter(req)).lean();
    if (!conversation) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });
    res.json({ status: 'ok', conversation });
  } catch (error) { next(error); }
}

export async function renameConversation(req, res, next) {
  try {
    const title = String(req.body.title || '').trim();
    if (!title || title.length > 100) return res.status(400).json({ status: 'error', message: 'Title must be between 1 and 100 characters.' });
    const conversation = await Conversation.findOneAndUpdate(ownerFilter(req), { title, hasCustomTitle: true }, { new: true, runValidators: true });
    if (!conversation) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });
    res.json({ status: 'ok', conversation: { id: conversation._id, title: conversation.title, updatedAt: conversation.updatedAt } });
  } catch (error) { next(error); }
}

export async function deleteConversation(req, res, next) {
  try {
    const conversation = await Conversation.findOneAndDelete(ownerFilter(req));
    if (!conversation) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
}

export async function addMessage(req, res, next) {
  try {
    const content = String(req.body.content || '').trim();
    if (!content || content.length > 20000) return res.status(400).json({ status: 'error', message: 'Message must be between 1 and 20,000 characters.' });
    if (req.body.documentIds !== undefined && (!Array.isArray(req.body.documentIds) || req.body.documentIds.length > 50)) {
      return res.status(400).json({ status: 'error', message: 'Choose no more than 50 documents.' });
    }
    const conversation = await Conversation.findOne(ownerFilter(req));
    if (!conversation) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });

    const history = conversation.messages.slice(-10).map((message) => ({
      role: message.role,
      content: message.content,
      sources: message.sources,
    }));
    conversation.messages.push({ role: 'user', content });
    if (!conversation.hasCustomTitle && conversation.messages.length === 2) {
      conversation.title = content.replace(/\s+/g, ' ').slice(0, 55) || 'New conversation';
    }
    await conversation.save();

    let reply;
    try {
      reply = await createAssistantReply({ content, user: req.user, conversation, history, documentIds: req.body.documentIds });
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        status: 'error',
        message: error.message || 'The assistant could not respond. Please try again.',
        conversationId: conversation._id,
        conversationTitle: conversation.title,
        persistedUserMessage: conversation.messages.at(-1),
      });
    }

    conversation.messages.push({
      role: 'assistant',
      content: reply.content,
      agentName: reply.agentName,
      agentNames: reply.agentNames,
      agentResults: reply.agentResults || [],
      sources: reply.sources || [],
    });
    await conversation.save();

    const savedMessages = conversation.messages.slice(-2);
    res.status(201).json({ status: 'ok', conversationId: conversation._id, title: conversation.title, messages: savedMessages });
  } catch (error) { next(error); }
}
