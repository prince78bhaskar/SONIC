import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60) * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(otp) {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('OTP_SECRET must be configured.');
  return createHmac('sha256', secret).update(otp).digest('hex');
}

export function verifyOtp(otp, hash) {
  if (!/^\d{6}$/.test(otp || '') || !hash) return false;
  const actual = Buffer.from(hashOtp(otp), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
