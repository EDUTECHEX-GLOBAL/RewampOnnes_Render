require('dotenv').config();

const fs = require('fs');

// Brevo's transactional email API. Sending over plain HTTPS instead of a
// raw SMTP socket connection avoids the IPv6/IPv4 routing problems we hit
// with Gmail SMTP on Render (ENETUNREACH errors) entirely — there's no
// socket-level connection to fail.
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;

// IMPORTANT: Brevo's transactional API does not support inline (CID)
// images at all — confirmed directly by Brevo support. Any image that
// needs to render INSIDE the email body (logo, intro image, contributor
// photos) must already be a self-contained base64 data URI baked into
// the htmlContent passed in here — see newsletterRoutes.js, which builds
// the HTML that way now. This file only ever deals with genuine
// downloadable attachments (e.g. a PDF), which Brevo's `attachment`
// array is actually for.

// Converts whatever attachment shape a caller might pass — a Buffer under
// `.content`, a filesystem `.path`, or a hosted `.url` — into the
// { content: base64String, name } (or { url, name }) shape Brevo's API
// expects. Brevo determines content-type from the filename's extension,
// so every attachment MUST have a `filename`/`name` with a real extension.
function toBrevoAttachment(att) {
  if (!att) return null;
  const name = att.filename || att.name;
  if (!name) {
    console.warn('Skipping attachment with no filename — Brevo requires one.');
    return null;
  }

  if (att.url) {
    return { url: att.url, name };
  }

  if (att.content) {
    const base64 = Buffer.isBuffer(att.content)
      ? att.content.toString('base64')
      : Buffer.from(att.content).toString('base64');
    return { content: base64, name };
  }

  if (att.path) {
    try {
      const base64 = fs.readFileSync(att.path).toString('base64');
      return { content: base64, name };
    } catch (err) {
      console.error(`Failed to read attachment at ${att.path}:`, err.message);
      return null;
    }
  }

  console.warn(`Skipping attachment "${name}" — no content, path, or url provided.`);
  return null;
}

// options: { fromName?: string, headers?: object }
async function sendMail(to, subject, htmlContent, attachments = [], plainText = "", options = {}) {
  try {
    if (!BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY is not set in the environment.');
    }
    if (!BREVO_SENDER_EMAIL) {
      throw new Error('BREVO_SENDER_EMAIL is not set in the environment.');
    }

    const fromName = options.fromName || "Onnes Aerospace";

    const payload = {
      sender: { name: fromName, email: BREVO_SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent,
    };

    if (plainText) {
      payload.textContent = plainText;
    }

    const brevoAttachments = (attachments || []).map(toBrevoAttachment).filter(Boolean);
    if (brevoAttachments.length > 0) {
      payload.attachment = brevoAttachments;
    }

    // Brevo's API only accepts custom (non-standard) headers here — this
    // still carries through the List-Unsubscribe headers set in
    // newsletterRoutes.js's buildStandardMailOptions().
    if (options.headers && Object.keys(options.headers).length > 0) {
      payload.headers = options.headers;
    }

    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Brevo API responded ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    console.log("Email sent:", data.messageId);
    return data;
  } catch (error) {
    console.error(`Email error (${to}):`, error.message);
    return null;
  }
}

module.exports = sendMail;