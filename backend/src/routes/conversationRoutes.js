import { Router } from 'express';
import { addMessage, createConversation, deleteConversation, getConversation, listConversations, renameConversation } from '../controllers/conversationController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.get('/', listConversations);
router.post('/', createConversation);
router.get('/:id', getConversation);
router.patch('/:id', renameConversation);
router.delete('/:id', deleteConversation);
router.post('/:id/messages', addMessage);

export default router;
