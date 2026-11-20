// Admin/routes/systemBrochureRoutes.js
// Mounted at /api/admin-system-brochures — every route is protected by authMiddleware.
//
// Storage strategy:
//   1. The PDF is always saved to MongoDB first (guaranteed copy).
//   2. It is then uploaded to Cloudinary. If that fails for ANY reason
//      (free-tier limit, bad keys, outage), the upload still succeeds and
//      the brochure is simply served from MongoDB.

const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const SystemBrochure = require('../models/SystemBrochure');
const authMiddleware = require('../middleware/authMiddleware');

// Largest PDF accepted. MongoDB documents are capped at 16MB, so keep a margin.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_DATA_URL_PREFIX = 'data:application/pdf;base64,';
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLOUDINARY_FOLDER = 'onnes/system-brochures';

const publicIdFor = (slug) => `${CLOUDINARY_FOLDER}/${slug}.pdf`;

// Configure lazily: server.js loads this file BEFORE dotenv.config() runs,
// so the env vars are not available yet at require-time.
function getCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return null;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  return cloudinary;
}

function describeError(err) {
  const raw = (err && (err.message || (err.error && err.error.message))) || 'Cloudinary upload failed';
  return String(raw).slice(0, 300);
}

// Tries to put the PDF on Cloudinary. NEVER throws — returns { ok, url } or { ok:false, error }.
async function syncToCloudinary(buffer, slug) {
  const cloud = getCloudinary();
  if (!cloud) return { ok: false, error: 'Cloudinary is not configured on the server.' };

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloud.uploader.upload_stream(
        {
          resource_type: 'raw',
          public_id: publicIdFor(slug),
          overwrite: true,
          invalidate: true,
          timeout: 60000,
        },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(buffer);
    });
    return { ok: true, url: result.secure_url };
  } catch (err) {
    console.error(`Cloudinary upload failed for "${slug}":`, describeError(err));
    return { ok: false, error: describeError(err) };
  }
}

function parsePdfDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PDF_DATA_URL_PREFIX)) return null;
  // Cheap size guard before decoding (base64 is ~1.37x the binary size).
  if (value.length > MAX_PDF_BYTES * 1.4) return null;
  const buffer = Buffer.from(value.slice(PDF_DATA_URL_PREFIX.length), 'base64');
  if (!buffer.length || buffer.slice(0, 5).toString() !== '%PDF-') return null;
  return buffer;
}

function sanitizeFileName(name, slug) {
  const base = String(name || '').replace(/[^\w.\- ]+/g, '').trim();
  if (!base) return `Onnes-${slug}-Brochure.pdf`;
  return base.toLowerCase().endsWith('.pdf') ? base.slice(0, 120) : `${base.slice(0, 115)}.pdf`;
}

// What the admin screen needs — never includes the binary.
function toSummary(doc) {
  return {
    slug: doc.slug,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    inDatabase: true,
    inCloudinary: !!doc.cloudinaryUrl,
    cloudinaryError: doc.cloudinaryError || '',
    updatedAt: doc.updatedAt,
  };
}

// Reject malformed slugs with a clean 404.
router.param('slug', (req, res, next, slug) => {
  if (!SLUG_PATTERN.test(slug) || slug.length > 100) {
    return res.status(404).json({ message: 'Brochure not found' });
  }
  next();
});

// GET /api/admin-system-brochures — every uploaded brochure (no binaries).
router.get('/', authMiddleware, async (req, res) => {
  try {
    const docs = await SystemBrochure.find().select('-fileData');
    res.status(200).json(docs.map(toSummary));
  } catch (err) {
    console.error('Error fetching brochures:', err);
    res.status(500).json({ message: 'Error fetching brochures' });
  }
});

// PUT /api/admin-system-brochures/:slug — upload or replace.
// Body: { fileData: "data:application/pdf;base64,....", fileName: "x.pdf" }
router.put('/:slug', authMiddleware, async (req, res) => {
  try {
    const { slug } = req.params;
    const { fileData, fileName } = req.body;

    const buffer = parsePdfDataUrl(fileData);
    if (!buffer) {
      return res.status(400).json({ message: 'Please upload a valid PDF file.' });
    }
    if (buffer.length > MAX_PDF_BYTES) {
      return res.status(400).json({ message: 'PDF is too large. Maximum size is 10 MB.' });
    }

    // 1) Database copy first. The old Cloudinary link is cleared in the same
    //    write so a failed re-upload can never leave a stale file being served.
    await SystemBrochure.findOneAndUpdate(
      { slug },
      {
        $set: {
          fileData: buffer,
          fileName: sanitizeFileName(fileName, slug),
          fileSize: buffer.length,
          cloudinaryUrl: '',
          cloudinaryError: '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 2) Best-effort Cloudinary upload.
    const sync = await syncToCloudinary(buffer, slug);
    const doc = await SystemBrochure.findOneAndUpdate(
      { slug },
      { $set: sync.ok ? { cloudinaryUrl: sync.url, cloudinaryError: '' } : { cloudinaryUrl: '', cloudinaryError: sync.error } },
      { new: true }
    ).select('-fileData');

    res.status(200).json(toSummary(doc));
  } catch (err) {
    console.error('Error saving brochure:', err);
    res.status(500).json({ message: 'Error saving brochure' });
  }
});

// POST /api/admin-system-brochures/:slug/retry-cloudinary
// Re-sends the database copy to Cloudinary (e.g. after the monthly limit resets).
router.post('/:slug/retry-cloudinary', authMiddleware, async (req, res) => {
  try {
    const { slug } = req.params;
    const stored = await SystemBrochure.findOne({ slug }).select('+fileData');
    if (!stored || !stored.fileData) {
      return res.status(404).json({ message: 'No brochure uploaded for this system.' });
    }

    const sync = await syncToCloudinary(Buffer.from(stored.fileData), slug);
    const doc = await SystemBrochure.findOneAndUpdate(
      { slug },
      { $set: sync.ok ? { cloudinaryUrl: sync.url, cloudinaryError: '' } : { cloudinaryUrl: '', cloudinaryError: sync.error } },
      { new: true }
    ).select('-fileData');

    res.status(200).json(toSummary(doc));
  } catch (err) {
    console.error('Error retrying Cloudinary sync:', err);
    res.status(500).json({ message: 'Error syncing to Cloudinary' });
  }
});

// DELETE /api/admin-system-brochures/:slug
router.delete('/:slug', authMiddleware, async (req, res) => {
  try {
    const { slug } = req.params;
    const deleted = await SystemBrochure.findOneAndDelete({ slug }).select('-fileData');
    if (!deleted) return res.status(404).json({ message: 'Brochure not found' });

    // Best-effort cleanup on Cloudinary; a failure here must not block the delete.
    const cloud = getCloudinary();
    if (cloud) {
      try {
        await cloud.uploader.destroy(publicIdFor(slug), { resource_type: 'raw', invalidate: true });
      } catch (err) {
        console.error(`Cloudinary delete failed for "${slug}":`, describeError(err));
      }
    }

    res.status(200).json({ message: 'Brochure deleted' });
  } catch (err) {
    console.error('Error deleting brochure:', err);
    res.status(500).json({ message: 'Error deleting brochure' });
  }
});

module.exports = router;