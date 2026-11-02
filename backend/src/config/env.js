import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(configDirectory, '../../.env');

// Resolve from this file, not process.cwd(), so `node backend/src/server.js`
// and `npm start` from backend both load the same backend/.env.
const result = dotenv.config({ path: envPath, quiet: true });

if (result.error && result.error.code !== 'ENOENT') {
  throw new Error('Unable to load backend/.env. Check that the file is readable.');
}

export function getSmtpConfig() {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    const error = new Error(`Email is not configured. Set ${missing.join(', ')} in backend/.env.`);
    error.statusCode = 503;
    throw error;
  }

  const portValue = process.env.SMTP_PORT?.trim() || '587';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error('Invalid SMTP_PORT. Set it to a valid port number (Gmail: 587).');
    error.statusCode = 503;
    throw error;
  }

  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase() || 'false';
  if (!['true', 'false'].includes(secureValue)) {
    const error = new Error('Invalid SMTP_SECURE. Set it to true or false (Gmail port 587: false).');
    error.statusCode = 503;
    throw error;
  }

  return {
    host: process.env.SMTP_HOST.trim(),
    port,
    secure: secureValue === 'true',
    auth: { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS },
    from: process.env.EMAIL_FROM?.trim() || process.env.MAIL_FROM?.trim() || process.env.SMTP_USER.trim(),
  };
}
