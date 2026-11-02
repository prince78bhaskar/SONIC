import nodemailer from 'nodemailer';
import { getSmtpConfig } from '../config/env.js';

let testTransport;

function getTransport() {
  if (testTransport) return testTransport;
  const { host, port, secure, auth } = getSmtpConfig();
  return nodemailer.createTransport({ host, port, secure, auth });
}

export function setEmailTransportForTests(transport) {
  testTransport = transport;
}

export async function verifyEmailTransport() {
  return getTransport().verify();
}

export async function sendOtpEmail({ to, name, otp, purpose }) {
  const verification = purpose === 'verification';
  const subject = verification ? 'Verify your Forma account' : 'Reset your Forma password';
  const action = verification ? 'verify your email address' : 'reset your password';
  const from = process.env.EMAIL_FROM?.trim() || process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim();
  try {
    return await getTransport().sendMail({
      from,
      to,
      subject,
      text: `Hi ${name},\n\nUse ${otp} to ${action}. This code expires in 5 minutes. If you did not request this, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#292839"><h2>${subject}</h2><p>Hi ${escapeHtml(name)},</p><p>Use this one-time code to ${action}:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#7765d9">${otp}</p><p>This code expires in 5 minutes. If you did not request this, you can ignore this email.</p></div>`,
    });
  } catch (error) {
    const failure = new Error(getDeliveryErrorMessage(error));
    failure.name = 'EmailDeliveryError';
    failure.code = 'EMAIL_DELIVERY_FAILED';
    failure.statusCode = 503;
    throw failure;
  }
}

function getDeliveryErrorMessage(error) {
  if (error?.code === 'EAUTH' || error?.responseCode === 535) {
    return 'SMTP authentication failed. Check SMTP_USER and use a Gmail app password for SMTP_PASS.';
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED'].includes(error?.code)) {
    return 'Could not connect to the SMTP server. Check SMTP_HOST, SMTP_PORT, and network access.';
  }
  return 'The email provider could not deliver the message. Check the SMTP configuration and try again.';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
