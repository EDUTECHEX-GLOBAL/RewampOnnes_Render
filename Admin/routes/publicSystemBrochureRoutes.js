// Admin/routes/publicSystemBrochureRoutes.js
// Mounted at /api/system-brochure — public, unauthenticated.
//
//   GET /:slug/status  -> { available: true|false }
//   GET /:slug         -> the PDF as a download
//
// Download order: Cloudinary (fast) if it is reachable right now,
// otherwise the copy stored in MongoDB. The visitor never sees an error
// just because Cloudinary is down or over its free-tier limit.

const express = require('express');
const router = express.Router();
const SystemBrochure = require('../models/SystemBrochure');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REACHABILITY_TIMEOUT_MS = 3000;

router.param('slug', (req, res, next, slug) => {
  if (!SLUG_PATTERN.test(slug) || slug.length > 100) {
    return res.status(404).json({ message: 'Brochure not found' });
  }
  next();
});

// Quick HEAD request so we only redirect when Cloudinary will really deliver.
async function isReachable(url) {
  if (typeof fetch !== 'function') return false; // very old Node — use the database copy
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Prefer a URL that forces a download; fall back to the plain URL.
async function pickCloudinaryUrl(url) {
  const candidates = [];
  if (url.includes('/upload/')) candidates.push(url.replace('/upload/', '/upload/fl_attachment/'));
  candidates.push(url);

  for (const candidate of candidates) {
    if (await isReachable(candidate)) return candidate;
  }
  return null;
}

// GET /api/system-brochure/:slug/status
router.get('/:slug/status', async (req, res) => {
  try {
    const exists = await SystemBrochure.exists({ slug: req.params.slug });
    res.status(200).json({ available: !!exists });
  } catch (err) {
    console.error('Error checking brochure status:', err);
    res.status(500).json({ message: 'Error checking brochure' });
  }
});

// GET /api/system-brochure/:slug — download
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const meta = await SystemBrochure.findOne({ slug }).select('cloudinaryUrl');
    if (!meta) return res.status(404).json({ message: 'Brochure not available yet.' });

    // 1) Cloudinary, when it is working.
    if (meta.cloudinaryUrl) {
      const target = await pickCloudinaryUrl(meta.cloudinaryUrl);
      if (target) {
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, target);
      }
    }

    // 2) Fallback: the copy stored in MongoDB.
    const doc = await SystemBrochure.findOne({ slug }).select('+fileData fileName');
    if (!doc || !doc.fileData) {
      return res.status(404).json({ message: 'Brochure not available yet.' });
    }

    const fileName = doc.fileName || `Onnes-${slug}-Brochure.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', doc.fileData.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(doc.fileData);
  } catch (err) {
    console.error('Error serving brochure:', err);
    res.status(500).json({ message: 'Error fetching brochure' });
  }
});

module.exports = router;