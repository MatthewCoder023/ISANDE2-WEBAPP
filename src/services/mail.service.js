const nodemailer = require('nodemailer');

/**
 * Outbound email. Configured entirely from the environment (SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM); when no SMTP host is set —
 * development and tests — messages are captured in an in-memory outbox
 * (and logged in dev) instead of being sent, so every flow works
 * end-to-end without an email account.
 *
 * Sending is fire-and-forget by design: a mail failure must never break
 * the order or auth flow that triggered it.
 */

const isConfigured = Boolean(process.env.SMTP_HOST);

const transport = isConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;

const FROM = process.env.MAIL_FROM || 'Flavor & Color <no-reply@flavorandcolor.local>';

/** Captured messages when SMTP is not configured (newest last, capped). */
const outbox = [];
const OUTBOX_LIMIT = 50;

function sendMail({ to, subject, text }) {
  if (!to) return Promise.resolve();

  if (!transport) {
    outbox.push({ to, subject, text, at: new Date() });
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[mail:dev] To: ${to} — ${subject}`);
    }
    return Promise.resolve();
  }

  return transport.sendMail({ from: FROM, to, subject, text }).catch((err) => {
    console.error(`Failed to send "${subject}" to ${to}:`, err.message);
  });
}

module.exports = { sendMail, outbox, isConfigured };
