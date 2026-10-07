const express = require('express');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const mongoose = require('mongoose');
const router = express.Router();
const NewsletterRecipient = require('../models/NewsletterRecipient');
const Newsletter = require('../models/Newsletter');
const Subscription = require('../models/Subscription');
const sendMail = require('../utils/mailer');
const authMiddleware = require('../middleware/authMiddleware');
const { buildNewsletterHTML, htmlToPlainText } = require('../utils/newsletterTemplate');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Placeholder swapped for the actual recipient's address right before each
// send, so the footer can say "Unsubscribe your email address ( x@y.com )
// from our newsletter." the way Starburst's does, without building a
// separate HTML string per recipient up front.
const RECIPIENT_PLACEHOLDER = '%%RECIPIENT_EMAIL%%';

// Base URL used to build public article links (e.g. the "Read More" CTA
// and the auto-published /blogs/:slug page). Set FRONTEND_BASE_URL in your
// .env for local dev (e.g. http://localhost:3000) — this falls back to
// the production domain if it's not set.
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://onnesaerospace.com';

// Public base URL of THIS backend, used to build the image URLs that go
// into the sent email (logo, intro image, contributor photos). Gmail
// does not render base64 data: images and clips any email whose HTML is
// over ~102KB, so images must be real hosted URLs. Optionally set
// BACKEND_BASE_URL in .env (e.g. https://your-service.onrender.com); if
// it's not set, it's derived from the incoming request (trust proxy is
// already enabled in server.js, so this resolves to https on Render).
const BACKEND_BASE_URL_ENV = (process.env.BACKEND_BASE_URL || '').replace(/\/+$/, '');
function resolveBackendBaseUrl(req) {
  if (BACKEND_BASE_URL_ENV) return BACKEND_BASE_URL_ENV;
  return `${req.protocol}://${req.get('host')}`;
}

// Mount path of this router in server.js — used when building the public
// asset URLs below.
const ROUTER_MOUNT_PATH = '/api/admin-newsletter';

// Turns a newsletter subject into a URL-safe slug, e.g.
// "Onnes Aerospace — Monthly Update!" -> "onnes-aerospace-monthly-update".
// A short suffix (from the record's own ObjectId) is appended by the
// caller to keep slugs unique even when subjects repeat.
function slugify(str = '') {
  return str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'update';
}

// Sending tuning. Kept small and conservative on purpose — this keeps a
// gentle, even pace of outbound sends regardless of provider.
const CONCURRENCY = 3;          // emails in flight at once
const BATCH_PAUSE_MS = 500;     // pause between batches
const MAX_ATTEMPTS = 3;         // 1 try + 2 retries per email
const RETRY_BASE_DELAY_MS = 2000; // backoff grows with attempt number

// How long a 'project_updates' article page stays reachable at its link
// before publicBlogRoutes starts returning 410 Gone for it. 'generic'
// article pages are the permanent public blog and never expire.
// Override via .env — no code change needed to adjust it.
const PROJECT_UPDATE_LINK_EXPIRY_DAYS = Number(process.env.PROJECT_UPDATE_LINK_EXPIRY_DAYS) || 30;

//////////////////////////////////////////////////////////////////
// RECIPIENT MANAGEMENT (Clients & Investors)
//////////////////////////////////////////////////////////////////

router.get('/recipients/counts', authMiddleware, async (req, res) => {
  try {
    const [generalCount, clientCount, investorCount] = await Promise.all([
      Subscription.countDocuments(),
      NewsletterRecipient.countDocuments({ category: 'client' }),
      NewsletterRecipient.countDocuments({ category: 'investor' }),
    ]);
    res.status(200).json({
      general: generalCount,
      client: clientCount,
      investor: investorCount,
    });
  } catch (err) {
    console.error('Error fetching recipient counts:', err);
    res.status(500).json({ message: 'Error fetching recipient counts' });
  }
});

router.get('/recipients', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;

    const recipients = await NewsletterRecipient.find(filter).sort({ createdAt: -1 });
    res.status(200).json(recipients);
  } catch (err) {
    console.error('Error fetching recipients:', err);
    res.status(500).json({ message: 'Error fetching recipients' });
  }
});

router.post('/recipients', authMiddleware, async (req, res) => {
  try {
    const { name, email, category, status } = req.body;

    if (!email || !category || !status) {
      return res.status(400).json({ message: 'email, category and status are required.' });
    }
    if (!['client', 'investor'].includes(category)) {
      return res.status(400).json({ message: 'category must be "client" or "investor".' });
    }
    if (!['existing', 'future'].includes(status)) {
      return res.status(400).json({ message: 'status must be "existing" or "future".' });
    }

    const existing = await NewsletterRecipient.findOne({
      email: email.toLowerCase().trim(),
      category,
    });
    if (existing) {
      return res.status(400).json({ message: 'This email is already in that category.' });
    }

    const recipient = new NewsletterRecipient({ name, email, category, status });
    await recipient.save();
    res.status(201).json(recipient);
  } catch (err) {
    console.error('Error adding recipient:', err);
    res.status(500).json({ message: 'Error adding recipient' });
  }
});

router.put('/recipients/:id', authMiddleware, async (req, res) => {
  try {
    const { name, email, category, status } = req.body;
    const updated = await NewsletterRecipient.findByIdAndUpdate(
      req.params.id,
      { name, email, category, status },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Recipient not found' });
    res.status(200).json(updated);
  } catch (err) {
    console.error('Error updating recipient:', err);
    res.status(500).json({ message: 'Error updating recipient' });
  }
});

router.delete('/recipients/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await NewsletterRecipient.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Recipient not found' });
    res.status(200).json({ message: 'Recipient deleted' });
  } catch (err) {
    console.error('Error deleting recipient:', err);
    res.status(500).json({ message: 'Error deleting recipient' });
  }
});

//////////////////////////////////////////////////////////////////
// SEND NEWSLETTER
//////////////////////////////////////////////////////////////////

async function resolveAudience(type) {
  if (type === 'generic') {
    const [subs, recipients] = await Promise.all([
      Subscription.find().select('email'),
      NewsletterRecipient.find().select('email category'),
    ]);
    const emails = new Set([
      ...subs.map((s) => s.email),
      ...recipients.map((r) => r.email),
    ]);
    return { emails: [...emails], audience: ['general', 'client', 'investor'] };
  }

  if (type === 'project_updates') {
    const recipients = await NewsletterRecipient.find({
      category: { $in: ['client', 'investor'] },
    }).select('email');
    const emails = [...new Set(recipients.map((r) => r.email))];
    return { emails, audience: ['client', 'investor'] };
  }

  return { emails: [], audience: [] };
}

// Resizes + recompresses an inline image before it goes into every single
// recipient's email as a data URI. Images are capped to the email's
// content width (the template renders at 600px).
async function compressImageBuffer(buffer, mimeType) {
  try {
    const base = sharp(buffer).resize({ width: 640, withoutEnlargement: true });

    if (mimeType === 'image/png') {
      const out = await base.png({ quality: 70, compressionLevel: 9 }).toBuffer();
      return { buffer: out, ext: 'png' };
    }

    const out = await base.jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    return { buffer: out, ext: 'jpg' };
  } catch (err) {
    console.error('Image compression failed, falling back to original:', err.message);
    return null;
  }
}

// Same idea, but for small circular contributor thumbnails — no need for
// a 640px-wide buffer behind a 64px avatar.
async function compressAvatarBuffer(buffer, mimeType) {
  try {
    const base = sharp(buffer).resize({ width: 160, withoutEnlargement: true });

    if (mimeType === 'image/png') {
      const out = await base.png({ quality: 75, compressionLevel: 9 }).toBuffer();
      return { buffer: out, ext: 'png' };
    }

    const out = await base.jpeg({ quality: 75, mozjpeg: true }).toBuffer();
    return { buffer: out, ext: 'jpg' };
  } catch (err) {
    console.error('Avatar compression failed, falling back to original:', err.message);
    return null;
  }
}

// Turns a single "data:image/...;base64,..." string into a COMPRESSED
// base64 data URI, ready to drop straight into an <img src="..."> tag.
//
// NOTE: no longer used for the SENT email. Gmail doesn't render data:
// image URIs and clips emails over ~102KB, so the sent email now
// references hosted image URLs instead (see the public /assets routes
// and buildEmailImageUrls below). Kept as-is for reference/other use.
// Returns null if the input isn't a valid base64 image (e.g. empty/unset).
async function embedBase64Image(dataUrl, compressFn = compressImageBuffer) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1];
  const originalBuffer = Buffer.from(match[2], 'base64');
  const compressed = await compressFn(originalBuffer, mimeType);

  const outMimeType = compressed
    ? (compressed.ext === 'png' ? 'image/png' : 'image/jpeg')
    : mimeType;
  const buffer = compressed ? compressed.buffer : originalBuffer;

  return `data:${outMimeType};base64,${buffer.toString('base64')}`;
}

// Reads the company logo file once and caches it as a base64 data URI.
// Still used for the STORED dashboard-preview HTML (an iframe renders
// data URIs fine). The SENT email uses the hosted logo URL instead.
let cachedLogoDataUri = null;
function getLogoDataUri() {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  try {
    const logoPath = path.join(__dirname, '../utils/onnes-wordmark.png');
    const buffer = fs.readFileSync(logoPath);
    cachedLogoDataUri = `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('Failed to read logo file for email embedding:', err.message);
    cachedLogoDataUri = '';
  }
  return cachedLogoDataUri;
}

//////////////////////////////////////////////////////////////////
// PUBLIC EMAIL IMAGE ASSETS (no auth — email clients must be able to
// fetch these). Gmail/Outlook load <img src="https://..."> fine, whereas
// base64 data: images are blocked and bloat the HTML past Gmail's
// ~102KB clipping limit.
//////////////////////////////////////////////////////////////////

// Small in-memory cache of already-compressed images so repeated opens
// don't re-run Sharp every time. Cleared on restart; that's fine — it
// just gets rebuilt on the next request.
const EMAIL_IMAGE_CACHE_MAX = 100;
const emailImageCache = new Map();

function cacheEmailImage(key, value) {
  if (emailImageCache.size >= EMAIL_IMAGE_CACHE_MAX) {
    const oldestKey = emailImageCache.keys().next().value;
    emailImageCache.delete(oldestKey);
  }
  emailImageCache.set(key, value);
}

async function sendStoredDataUrlImage(res, cacheKey, dataUrl, compressFn) {
  const cached = emailImageCache.get(cacheKey);
  if (cached) {
    res.set('Content-Type', cached.mimeType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(cached.buffer);
  }

  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(404).end();
  }
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return res.status(404).end();

  const mimeType = match[1];
  const originalBuffer = Buffer.from(match[2], 'base64');
  const compressed = await compressFn(originalBuffer, mimeType);

  const outMimeType = compressed
    ? (compressed.ext === 'png' ? 'image/png' : 'image/jpeg')
    : mimeType;
  const outBuffer = compressed ? compressed.buffer : originalBuffer;

  cacheEmailImage(cacheKey, { buffer: outBuffer, mimeType: outMimeType });

  res.set('Content-Type', outMimeType);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res.status(200).send(outBuffer);
}

// Company logo used in the email header.
router.get('/assets/logo.png', (req, res) => {
  const logoPath = path.join(__dirname, '../utils/onnes-wordmark.png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(logoPath, (err) => {
    if (err && !res.headersSent) {
      console.error('Failed to serve logo asset:', err.message);
      res.status(404).end();
    }
  });
});

// Intro image of a specific newsletter.
router.get('/assets/:id/intro', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).end();

    const cacheKey = `${id}:intro`;
    if (emailImageCache.has(cacheKey)) {
      return sendStoredDataUrlImage(res, cacheKey, null, compressImageBuffer);
    }

    const item = await Newsletter.findById(id).select('introImage');
    if (!item) return res.status(404).end();

    return sendStoredDataUrlImage(res, cacheKey, item.introImage, compressImageBuffer);
  } catch (err) {
    console.error('Error serving intro image asset:', err);
    res.status(500).end();
  }
});

// Contributor photo (by position in the newsletter's contributors list).
router.get('/assets/:id/contributor/:index', async (req, res) => {
  try {
    const { id } = req.params;
    const index = Number(req.params.index);
    if (!mongoose.Types.ObjectId.isValid(id) || !Number.isInteger(index) || index < 0) {
      return res.status(404).end();
    }

    const cacheKey = `${id}:contributor:${index}`;
    if (emailImageCache.has(cacheKey)) {
      return sendStoredDataUrlImage(res, cacheKey, null, compressAvatarBuffer);
    }

    const item = await Newsletter.findById(id).select('contributors');
    if (!item || !item.contributors || !item.contributors[index]) {
      return res.status(404).end();
    }

    return sendStoredDataUrlImage(res, cacheKey, item.contributors[index].photo, compressAvatarBuffer);
  } catch (err) {
    console.error('Error serving contributor image asset:', err);
    res.status(500).end();
  }
});

// Returns the resolved audience for a given newsletter type, with names
// where available, so the compose UI can render a selectable list instead
// of blindly sending to everyone the type resolves to.
router.get('/audience', authMiddleware, async (req, res) => {
  try {
    const { type } = req.query;
    if (!['generic', 'project_updates'].includes(type)) {
      return res.status(400).json({ message: 'Invalid newsletter type.' });
    }

    const byEmail = new Map();

    if (type === 'generic') {
      const [subs, recipients] = await Promise.all([
        Subscription.find().select('email'),
        NewsletterRecipient.find().select('name email category'),
      ]);
      subs.forEach((s) => {
        byEmail.set(s.email, { email: s.email, name: '', category: 'general' });
      });
      recipients.forEach((r) => {
        byEmail.set(r.email, { email: r.email, name: r.name || '', category: r.category });
      });
    } else {
      const recipients = await NewsletterRecipient.find({
        category: { $in: ['client', 'investor'] },
      }).select('name email category');
      recipients.forEach((r) => {
        byEmail.set(r.email, { email: r.email, name: r.name || '', category: r.category });
      });
    }

    res.status(200).json({ recipients: [...byEmail.values()] });
  } catch (err) {
    console.error('Error fetching audience:', err);
    res.status(500).json({ message: 'Error fetching audience' });
  }
});

// Builds the image srcs used inside the SENT email: hosted URLs pointing
// at the public /assets routes above (instead of base64 data URIs, which
// Gmail blocks and which push the HTML past Gmail's clipping limit).
// `contributors` must be the same ordered list that's stored on the
// Newsletter document, since the photo URL is keyed by list position.
function buildEmailImageUrls(backendBaseUrl, newsletterId, introImage, contributors) {
  const assetBase = `${backendBaseUrl}${ROUTER_MOUNT_PATH}/assets`;
  const isImageDataUrl = (v) => typeof v === 'string' && /^data:image\/[^;]+;base64,/.test(v);

  const introImageSrc = isImageDataUrl(introImage)
    ? `${assetBase}/${newsletterId}/intro`
    : null;

  const emailContributors = [];
  if (Array.isArray(contributors)) {
    for (let i = 0; i < contributors.length; i++) {
      const c = contributors[i];
      if (!c || !c.name) continue;
      emailContributors.push({
        name: c.name,
        photoSrc: isImageDataUrl(c.photo) ? `${assetBase}/${newsletterId}/contributor/${i}` : null,
      });
    }
  }

  return {
    introImageSrc,
    contributors: emailContributors,
    logoSrc: `${assetBase}/logo.png`,
  };
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Sends to one recipient, retrying a couple of times with backoff before
// giving up. A single slow/timed-out attempt no longer permanently marks
// someone as failed.
async function sendWithRetry(email, subject, html, attachments, plainText, mailOptions) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await sendMail(email, subject, html, attachments, plainText, mailOptions);
    if (result) return true;

    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  return false;
}

// Sends `emails` in small concurrent batches (instead of one at a time),
// with retries per email. `htmlTemplate` may contain RECIPIENT_PLACEHOLDER,
// which gets swapped for each actual address right before sending —
// this is what personalizes the "Unsubscribe your email address ( ... )"
// footer line per recipient. Returns { sentCount, failedEmails }.
async function sendToEmails(emails, subject, htmlTemplate, attachments, plainText, mailOptions) {
  let sentCount = 0;
  const failedEmails = [];

  const batches = chunkArray(emails, CONCURRENCY);
  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map((email) => {
        const html = htmlTemplate.split(RECIPIENT_PLACEHOLDER).join(email);
        return sendWithRetry(email, subject, html, attachments, plainText, mailOptions).then((ok) => ({
          email,
          ok,
        }));
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        sentCount += 1;
      } else {
        failedEmails.push(r.status === 'fulfilled' ? r.value.email : 'unknown');
      }
    }

    await delay(BATCH_PAUSE_MS);
  }

  return { sentCount, failedEmails };
}

function buildStandardMailOptions() {
  return {
    fromName: 'Onnes Aerospace',
    headers: {
      'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}?subject=Unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

router.post('/send', authMiddleware, async (req, res) => {
  try {
    const {
      type, subject, headline, bodyHtml, ctaText, ctaLink, selectedEmails,
      tagline, introText, introImage, subheading,
      highlightsTitle, highlights, authorNote, contributors, socialLinks,
    } = req.body;

    // Captured now (while `req` is available) for use inside the
    // background send block below.
    const backendBaseUrl = resolveBackendBaseUrl(req);

    if (!type || !subject || !headline) {
      return res.status(400).json({ message: 'type, subject and headline are required.' });
    }
    if (!['generic', 'project_updates'].includes(type)) {
      return res.status(400).json({ message: 'Invalid newsletter type.' });
    }

    const bodyText = htmlToPlainText(bodyHtml || '');
    const introTextTrimmed = (introText || '').trim();
    if (!bodyText.trim() && !introTextTrimmed) {
      return res.status(400).json({ message: 'Newsletter needs either intro text or additional content.' });
    }

    const { emails: resolvedEmails, audience } = await resolveAudience(type);

    if (resolvedEmails.length === 0) {
      return res.status(400).json({ message: 'No recipients found for this audience.' });
    }

    // selectedEmails, if provided, narrows the resolved audience down to
    // exactly who the admin checked in the recipient picker. It can only
    // narrow — anything not already part of the resolved audience for this
    // type is ignored, so the picker can't be used to add arbitrary emails.
    let emails = resolvedEmails;
    if (Array.isArray(selectedEmails) && selectedEmails.length > 0) {
      const allowed = new Set(resolvedEmails);
      emails = selectedEmails.filter((e) => allowed.has(e));
    }

    if (emails.length === 0) {
      return res.status(400).json({ message: 'No recipients selected.' });
    }

    const eyebrow = type === 'generic' ? 'Company Update' : 'Project Update';

    // Every newsletter with real "Additional Content" gets an article page
    // now, not just 'generic' ones — the email itself only ever shows a
    // teaser (see the emailHtmlContent build below), so there needs to be
    // somewhere for the full content to actually live, for BOTH types.
    //
    // The two types differ in exposure, not in whether the page exists:
    //   - 'generic'         -> also listed on the public /blogs page,
    //                          permanent (no expiresAt)
    //   - 'project_updates' -> never listed (publicBlogRoutes' GET / only
    //                          returns 'generic'), reachable only via the
    //                          exact link sent in the email, and expires
    //                          after PROJECT_UPDATE_LINK_EXPIRY_DAYS
    const newsletterId = new mongoose.Types.ObjectId();
    const hasArticleContent = !!(bodyHtml && bodyHtml.trim() && bodyHtml.trim() !== '<p></p>');

    let slug = '';
    let articleUrl = '';
    let expiresAt = null;
    if (hasArticleContent) {
      slug = `${slugify(subject)}-${newsletterId.toString().slice(-6)}`;
      articleUrl = `${FRONTEND_BASE_URL}/blogs/${slug}`;
      if (type === 'project_updates') {
        expiresAt = new Date(Date.now() + PROJECT_UPDATE_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      }
    }

    const finalCtaText = ctaText || (articleUrl
      ? (type === 'generic' ? 'Read the Full Article' : 'Read the Full Update')
      : '');
    const finalCtaLink = ctaLink || articleUrl;
    const cleanHighlights = Array.isArray(highlights) ? highlights.filter((h) => h && h.trim()) : [];
    const cleanContributors = Array.isArray(contributors)
      ? contributors.filter((c) => c && c.name && c.name.trim())
      : [];
    const cleanSocialLinks = socialLinks && typeof socialLinks === 'object' ? socialLinks : {};

    // Stored version: keeps images as base64 so it's fully self-contained
    // and viewable anytime from the dashboard History tab (a browser
    // iframe has no size-clipping limit the way email clients do). This
    // is the FULL version — it still includes the complete bodyHtml, so
    // the admin has one place to verify absolutely everything they typed
    // rendered correctly, independent of what the sent email itself shows.
    // This build is fast — no Sharp compression involved — so it's safe to
    // do before responding to the request. Uses the same cached logo data
    // URI as the actual email, so it renders correctly in the dashboard's
    // iframe preview too (a cid: reference never worked there either).
    const htmlContent = buildNewsletterHTML({
      subject,
      eyebrow,
      headline,
      tagline,
      introText,
      introImageSrc: introImage || null,
      subheading,
      bodyHtml,
      highlightsTitle,
      highlights: cleanHighlights,
      ctaText: finalCtaText,
      ctaLink: finalCtaLink,
      authorNote,
      contributors: cleanContributors.map((c) => ({ name: c.name, photoSrc: c.photo || null })),
      socialLinks: cleanSocialLinks,
      preheader: (introTextTrimmed || bodyText).slice(0, 150),
      unsubscribeEmail: process.env.EMAIL_USER,
      logoSrc: getLogoDataUri(),
    });

    // Built as a plain object first (instead of inline in `new Newsletter({...})`)
    // so `slug`/`expiresAt` can be conditionally attached below. This is
    // the actual fix: they're only added to the object when they have a
    // real value. If we instead always wrote `slug: slug` here, newsletters
    // with no article content would get `slug: ""` saved on the document —
    // which collides with the sparse unique index on `slug` the same way
    // `default: ''` did.
    const newsletterData = {
      _id: newsletterId,
      type,
      subject,
      headline,
      tagline: tagline || '',
      introText: introText || '',
      introImage: introImage || '',
      subheading: subheading || '',
      highlightsTitle: highlightsTitle || '',
      highlights: cleanHighlights,
      authorNote: authorNote || '',
      contributors: cleanContributors,
      socialLinks: cleanSocialLinks,
      bodyText,
      bodyHtml: bodyHtml || '', // raw editor HTML (base64 images), kept for resend-failed and the article page
      ctaText: finalCtaText,
      ctaLink: finalCtaLink,
      htmlContent,
      audience,
      totalRecipients: emails.length,
      status: 'sending',
    };

    // Leave slug/expiresAt out entirely when there's no article content, so
    // they stay undefined on the document (required for the sparse unique
    // index on slug — see the model).
    if (slug) {
      newsletterData.slug = slug;
    }
    if (expiresAt) {
      newsletterData.expiresAt = expiresAt;
    }

    const log = new Newsletter(newsletterData);
    await log.save();

    // Respond immediately.
    res.status(202).json({
      message: `Newsletter queued for ${emails.length} recipient(s).`,
      newsletterId: log._id,
      totalRecipients: emails.length,
    });

    setImmediate(async () => {
      try {
        // The "Additional Content" rich-text body is deliberately NOT
        // included in the sent email — it lives on the article page only
        // (see hasArticleContent / slug above).
        //
        // Images in the sent email are hosted URLs (served by the public
        // /assets routes above), not base64 — Gmail blocks data: images
        // and clips emails over ~102KB.
        const {
          introImageSrc: emailIntroImageSrc,
          contributors: emailContributors,
          logoSrc: emailLogoSrc,
        } = buildEmailImageUrls(backendBaseUrl, log._id, introImage, cleanContributors);

        const emailHtmlContent = buildNewsletterHTML({
          subject,
          eyebrow,
          headline,
          tagline,
          introText,
          introImageSrc: emailIntroImageSrc,
          subheading,
          bodyHtml: '', // teaser only — full content lives on the article page
          highlightsTitle,
          highlights: cleanHighlights,
          ctaText: finalCtaText,
          ctaLink: finalCtaLink,
          authorNote,
          contributors: emailContributors,
          socialLinks: cleanSocialLinks,
          preheader: (introTextTrimmed || bodyText).slice(0, 150),
          unsubscribeEmail: process.env.EMAIL_USER,
          recipientEmail: RECIPIENT_PLACEHOLDER,
          logoSrc: emailLogoSrc,
        });

        // No attachments needed — every image is a hosted URL now. This
        // array stays here (passed through to sendMail) purely so a
        // future genuine downloadable attachment (e.g. a PDF) could still
        // be added without changing this call site's shape.
        const attachments = [];

        const { sentCount, failedEmails } = await sendToEmails(
          emails,
          subject,
          emailHtmlContent,
          attachments,
          bodyText,
          buildStandardMailOptions()
        );

        log.sentCount = sentCount;
        log.failedEmails = failedEmails;
        log.status = failedEmails.length === 0
          ? 'completed'
          : (sentCount === 0 ? 'failed' : 'completed_with_errors');
        await log.save();

        console.log(`✅ Newsletter ${log._id} finished: ${sentCount}/${emails.length} sent`);
      } catch (bgErr) {
        console.error(`Error in background send for newsletter ${log._id}:`, bgErr);
        log.status = 'failed';
        await log.save().catch(() => {});
      }
    });

  } catch (err) {
    console.error('Error sending newsletter:', err);
    res.status(500).json({ message: 'Error sending newsletter' });
  }
});

//////////////////////////////////////////////////////////////////
// RESEND TO FAILED RECIPIENTS
//////////////////////////////////////////////////////////////////

router.post('/history/:id/resend-failed', authMiddleware, async (req, res) => {
  try {
    const log = await Newsletter.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Newsletter not found' });

    if (!log.failedEmails || log.failedEmails.length === 0) {
      return res.status(400).json({ message: 'No failed recipients to resend to.' });
    }
    if (!log.bodyHtml && !log.introText) {
      return res.status(400).json({
        message: 'This newsletter was sent before resend support was added and can\'t be auto-resent.',
      });
    }

    const emailsToRetry = [...log.failedEmails];
    const eyebrow = log.type === 'generic' ? 'Company Update' : 'Project Update';

    // Captured now (while `req` is available) for use inside the
    // background resend block below.
    const backendBaseUrl = resolveBackendBaseUrl(req);

    // Respond immediately.
    res.status(202).json({ message: `Resending to ${emailsToRetry.length} recipient(s).` });

    setImmediate(async () => {
      try {
        const {
          introImageSrc: emailIntroImageSrc,
          contributors: emailContributors,
          logoSrc: emailLogoSrc,
        } = buildEmailImageUrls(backendBaseUrl, log._id, log.introImage, log.contributors);

        const emailHtmlContent = buildNewsletterHTML({
          subject: log.subject,
          eyebrow,
          headline: log.headline || '',
          tagline: log.tagline,
          introText: log.introText,
          introImageSrc: emailIntroImageSrc,
          subheading: log.subheading,
          bodyHtml: '', // teaser only — full content lives on the article page
          highlightsTitle: log.highlightsTitle,
          highlights: log.highlights,
          ctaText: log.ctaText || '',
          ctaLink: log.ctaLink || '',
          authorNote: log.authorNote,
          contributors: emailContributors,
          socialLinks: log.socialLinks,
          preheader: (log.bodyText || '').slice(0, 150),
          unsubscribeEmail: process.env.EMAIL_USER,
          recipientEmail: RECIPIENT_PLACEHOLDER,
          logoSrc: emailLogoSrc,
        });

        // No attachments needed — see the matching comment in /send above.
        const attachments = [];

        const { sentCount: recovered, failedEmails: stillFailed } = await sendToEmails(
          emailsToRetry,
          log.subject,
          emailHtmlContent,
          attachments,
          log.bodyText || '',
          buildStandardMailOptions()
        );

        log.sentCount = (log.sentCount || 0) + recovered;
        log.failedEmails = stillFailed;
        log.status = stillFailed.length === 0
          ? 'completed'
          : (log.sentCount === 0 ? 'failed' : 'completed_with_errors');
        await log.save();

        console.log(`✅ Resend for newsletter ${log._id}: ${recovered}/${emailsToRetry.length} recovered`);
      } catch (bgErr) {
        console.error(`Error in background resend for newsletter ${log._id}:`, bgErr);
        await log.save().catch(() => {});
      }
    });
  } catch (err) {
    console.error('Error resending failed newsletter emails:', err);
    res.status(500).json({ message: 'Error resending newsletter' });
  }
});

//////////////////////////////////////////////////////////////////
// HISTORY
//////////////////////////////////////////////////////////////////

router.get('/history', authMiddleware, async (req, res) => {
  try {
    // Only select what the History list actually renders. Fetching
    // introImage / contributor photos (base64 images) for every row here
    // was previously blowing up response size/time once several sends
    // accumulated — see the createdAt index below too.
    const history = await Newsletter.find()
      .select('subject type sentCount totalRecipients status failedEmails slug createdAt')
      .sort({ createdAt: -1 })
      // Safety net alongside the createdAt index on the model: even if the
      // index can't be used for some reason, this lets Mongo spill the
      // sort to disk instead of hard-failing with the in-memory limit.
      .allowDiskUse(true);
    res.status(200).json(history);
  } catch (err) {
    console.error('Error fetching newsletter history:', err);
    res.status(500).json({ message: 'Error fetching history' });
  }
});

router.get('/history/:id', authMiddleware, async (req, res) => {
  try {
    const item = await Newsletter.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Newsletter not found' });
    res.status(200).json(item);
  } catch (err) {
    console.error('Error fetching newsletter:', err);
    res.status(500).json({ message: 'Error fetching newsletter' });
  }
});

module.exports = router;