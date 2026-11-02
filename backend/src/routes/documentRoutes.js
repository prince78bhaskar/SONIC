import { Router } from 'express';
import multer from 'multer';
import { removeDocument, listDocuments, uploadDocument, viewDocument } from '../controllers/documentController.js';
import { authenticate } from '../middleware/authenticate.js';
import { MAX_DOCUMENT_BYTES } from '../services/documentService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });
router.use(authenticate);
router.get('/', listDocuments);
router.post('/', upload.single('file'), uploadDocument);
router.get('/:id', viewDocument);
router.delete('/:id', removeDocument);

export default router;
