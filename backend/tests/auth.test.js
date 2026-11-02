import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../src/models/User.js';
import { connectDatabase, mongoose } from '../src/config/database.js';
import { setEmailTransportForTests } from '../src/services/emailService.js';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');

const emailPrefix = `auth-test-${Date.now()}`;
const email = `${emailPrefix}@example.test`;
const expiredEmail = `${emailPrefix}-expired@example.test`;
const attemptsEmail = `${emailPrefix}-attempts@example.test`;
const sentMail = [];
let server;
let baseUrl;

setEmailTransportForTests({ async sendMail(message) { sentMail.push(message); return { messageId: `test-${sentMail.length}` }; } });

async function call(path, body, token) {
  const response = await fetch(`${baseUrl}/api/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

function latestOtp() {
  const code = sentMail.at(-1)?.text.match(/Use (\d{6})/)?.[1];
  assert.ok(code, 'email contains a six-digit code');
  return code;
}

test('signup, OTP verification, login, protected route, and password recovery', async (t) => {
  assert.ok(process.env.JWT_SECRET?.length >= 32, 'JWT_SECRET is configured');
  assert.ok(process.env.OTP_SECRET?.length >= 32, 'OTP_SECRET is configured');
  await connectDatabase();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await User.deleteMany({ email: { $in: [email, expiredEmail, attemptsEmail] } });
    setEmailTransportForTests(undefined);
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  });

  const signup = await call('signup', { name: 'Test Person', email, password: 'Initial-password-123' });
  assert.equal(signup.response.status, 202);
  assert.match(signup.data.message, /5 minutes/);
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to, email);
  const verificationOtp = latestOtp();

  const pendingLogin = await call('login', { email, password: 'Initial-password-123' });
  assert.equal(pendingLogin.response.status, 403);
  assert.equal(pendingLogin.data.code, 'EMAIL_NOT_VERIFIED');

  const cooldown = await call('resend-verification', { email });
  assert.equal(cooldown.response.status, 429);
  assert.ok(cooldown.data.retryAfter > 0);

  const invalidOtp = await call('verify-email', { email, otp: '111111' });
  assert.equal(invalidOtp.response.status, 400);
  const verified = await call('verify-email', { email, otp: verificationOtp });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.data.user.email, email);
  assert.ok(verified.data.token);

  const privateDenied = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(privateDenied.status, 401);
  const privateAllowed = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${verified.data.token}` } });
  assert.equal(privateAllowed.status, 200);
  assert.equal((await privateAllowed.json()).user.name, 'Test Person');

  const wrongPassword = await call('login', { email, password: 'wrong-password' });
  assert.equal(wrongPassword.response.status, 401);
  const login = await call('login', { email, password: 'Initial-password-123' });
  assert.equal(login.response.status, 200);
  assert.ok(login.data.token);

  const forgot = await call('forgot-password', { email });
  assert.equal(forgot.response.status, 200);
  const resetOtp = latestOtp();
  const invalidReset = await call('reset-password', { email, otp: '111111', password: 'Changed-password-456' });
  assert.equal(invalidReset.response.status, 400);
  const reset = await call('reset-password', { email, otp: resetOtp, password: 'Changed-password-456' });
  assert.equal(reset.response.status, 200);
  assert.equal((await call('login', { email, password: 'Initial-password-123' })).response.status, 401);
  assert.equal((await call('login', { email, password: 'Changed-password-456' })).response.status, 200);

  const expiredSignup = await call('signup', { name: 'Expired Test', email: expiredEmail, password: 'Initial-password-123' });
  assert.equal(expiredSignup.response.status, 202);
  const expiredUser = await User.findOne({ email: expiredEmail });
  expiredUser.emailOtpExpiresAt = new Date(Date.now() - 1000);
  await expiredUser.save();
  const expiredCode = await call('verify-email', { email: expiredEmail, otp: latestOtp() });
  assert.equal(expiredCode.response.status, 400);
  assert.match(expiredCode.data.message, /expired/i);

  const attemptsSignup = await call('signup', { name: 'Attempts Test', email: attemptsEmail, password: 'Initial-password-123' });
  assert.equal(attemptsSignup.response.status, 202);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await call('verify-email', { email: attemptsEmail, otp: '111111' });
    assert.equal(failed.response.status, 400);
  }
  const locked = await call('verify-email', { email: attemptsEmail, otp: latestOtp() });
  assert.match(locked.data.message, /too many/i);

  const storedUser = await User.findOne({ email }).select('+passwordHash +passwordResetOtpHash');
  assert.notEqual(storedUser.passwordHash, 'Changed-password-456');
  assert.match(storedUser.passwordHash, /^\$2[ab]\$12\$/, 'passwords are stored as bcrypt hashes with cost 12');
  assert.equal(storedUser.passwordResetOtpHash, undefined);
});
