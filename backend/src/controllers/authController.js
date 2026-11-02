import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { sendOtpEmail } from '../services/emailService.js';
import { generateOtp, hashOtp, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS, verifyOtp } from '../utils/otp.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email });

function createToken(user) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
}

async function issueOtp(user, purpose) {
  const otp = generateOtp();
  const now = new Date();
  const prefix = purpose === 'verification' ? 'emailOtp' : 'passwordResetOtp';
  user[`${prefix}Hash`] = hashOtp(otp);
  user[`${prefix}ExpiresAt`] = new Date(now.getTime() + OTP_TTL_MS);
  user[`${prefix}SentAt`] = now;
  user[`${prefix}Attempts`] = 0;
  await user.save();
  try {
    await sendOtpEmail({ to: user.email, name: user.name, otp, purpose });
  } catch (error) {
    user[`${prefix}Hash`] = undefined;
    user[`${prefix}ExpiresAt`] = undefined;
    user[`${prefix}SentAt`] = undefined;
    await user.save();
    throw error;
  }
}

function consumeOtp(user, purpose, otp) {
  const prefix = purpose === 'verification' ? 'emailOtp' : 'passwordResetOtp';
  const attempts = user[`${prefix}Attempts`] || 0;
  if (attempts >= OTP_MAX_ATTEMPTS) return { error: 'Too many incorrect codes. Request a new code.' };
  if (!user[`${prefix}ExpiresAt`] || user[`${prefix}ExpiresAt`].getTime() <= Date.now()) {
    return { error: 'This code has expired. Request a new code.' };
  }
  if (!verifyOtp(otp, user[`${prefix}Hash`])) {
    user[`${prefix}Attempts`] = attempts + 1;
    return { error: 'The code is incorrect.' };
  }
  user[`${prefix}Hash`] = undefined;
  user[`${prefix}ExpiresAt`] = undefined;
  user[`${prefix}SentAt`] = undefined;
  user[`${prefix}Attempts`] = 0;
  return {};
}

export async function signup(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 80) return res.status(400).json({ status: 'error', message: 'Name must be between 2 and 80 characters.' });
    if (!emailPattern.test(email)) return res.status(400).json({ status: 'error', message: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ status: 'error', message: 'Password must be between 8 and 128 characters.' });
    let user = await User.findOne({ email }).select('+passwordHash');
    if (user?.isVerified) return res.status(409).json({ status: 'error', message: 'An account with this email already exists.' });
    const passwordHash = await bcrypt.hash(password, 12);
    if (!user) user = new User({ name, email, passwordHash });
    else { user.name = name; user.passwordHash = passwordHash; }
    await user.save();
    await issueOtp(user, 'verification');
    res.status(202).json({ status: 'ok', message: 'Verification code sent. It expires in 5 minutes.', email });
  } catch (error) { next(error); }
}

export async function verifyEmail(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email }).select('+emailOtpHash');
    if (!user || user.isVerified) return res.status(400).json({ status: 'error', message: 'No pending verification was found for this email.' });
    const result = consumeOtp(user, 'verification', String(req.body.otp || ''));
    if (result.error) { await user.save(); return res.status(400).json({ status: 'error', message: result.error }); }
    user.isVerified = true;
    await user.save();
    res.json({ status: 'ok', token: createToken(user), user: publicUser(user) });
  } catch (error) { next(error); }
}

export async function resendVerification(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email });
    if (!user || user.isVerified) return res.status(200).json({ status: 'ok', message: 'If an unverified account exists, a code has been sent.' });
    if (user.emailOtpSentAt && Date.now() - user.emailOtpSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - user.emailOtpSentAt.getTime())) / 1000);
      return res.status(429).json({ status: 'error', message: `Please wait ${waitSeconds} seconds before requesting another code.`, retryAfter: waitSeconds });
    }
    await issueOtp(user, 'verification');
    res.json({ status: 'ok', message: 'A new verification code has been sent.' });
  } catch (error) { next(error); }
}

export async function login(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
      return res.status(401).json({ status: 'error', message: 'Email or password is incorrect.' });
    }
    if (!user.isVerified) return res.status(403).json({ status: 'error', message: 'Verify your email before signing in.', code: 'EMAIL_NOT_VERIFIED' });
    res.json({ status: 'ok', token: createToken(user), user: publicUser(user) });
  } catch (error) { next(error); }
}

export async function forgotPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email, isVerified: true });
    if (!user) return res.json({ status: 'ok', message: 'If an account exists for this email, a reset code has been sent.' });
    if (user.passwordResetOtpSentAt && Date.now() - user.passwordResetOtpSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      return res.json({ status: 'ok', message: 'If an account exists for this email, a reset code has been sent.' });
    }
    await issueOtp(user, 'password-reset');
    res.json({ status: 'ok', message: 'If an account exists for this email, a reset code has been sent.' });
  } catch (error) { next(error); }
}

export async function resetPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email, isVerified: true }).select('+passwordResetOtpHash');
    if (!user) return res.status(400).json({ status: 'error', message: 'The code is invalid or expired.' });
    const password = String(req.body.password || '');
    if (password.length < 8 || password.length > 128) return res.status(400).json({ status: 'error', message: 'Password must be between 8 and 128 characters.' });
    const result = consumeOtp(user, 'password-reset', String(req.body.otp || ''));
    if (result.error) { await user.save(); return res.status(400).json({ status: 'error', message: result.error }); }
    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    res.json({ status: 'ok', message: 'Password reset successfully. You can now sign in.' });
  } catch (error) { next(error); }
}

export function getCurrentUser(req, res) {
  res.json({ status: 'ok', user: publicUser(req.user) });
}
