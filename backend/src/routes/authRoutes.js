import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { forgotPassword, getCurrentUser, login, resendVerification, resetPassword, signup, verifyEmail } from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();
const testLimit = process.env.NODE_ENV === 'test' ? 100 : undefined;
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: testLimit || 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { status: 'error', message: 'Too many authentication attempts. Try again later.' } });
const otpLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: testLimit || 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { status: 'error', message: 'Too many code requests. Try again later.' } });

router.post('/signup', authLimiter, signup);
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-verification', otpLimiter, resendVerification);
router.post('/login', authLimiter, login);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.get('/me', authenticate, getCurrentUser);

export default router;
