// Admin/routes/mediaNewsRoutes.js
// Mounted at /api/admin-media-news — every route is protected by authMiddleware.

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const MediaNews = require('../models/MediaNews');
const authMiddleware = require('../middleware/authMiddleware');

// Everything except the (large) base64 image.
const LIST_FIELDS =
  'title url publishedDate blurb hasImage isFeatured isPublished createdAt updatedAt';

// ~5MB of image once base64-encoded. The client already downsizes, this is a safety net.
const MAX_IMAGE_CHARS = 7000000;

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

// "2026-06-18" -> Date at UTC midnight.
function parseDate(value) {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(value);
}

// Only one article can be featured at a time.
async function unfeatureOthers(id) {
  await MediaNews.updateMany({ _id: { $ne: id }, isFeatured: true }, { isFeatured: false });
}

// Reject malformed ids with a clean 404 instead of a CastError 500.
router.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: 'News item not found' });
  }
  next();
});

// GET /api/admin-media-news — all items (drafts included), newest first.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const items = await MediaNews.find()
      .select(LIST_FIELDS)
      .sort({ publishedDate: -1, createdAt: -1 });
    res.status(200).json(items);
  } catch (err) {
    console.error('Error fetching news list:', err);
    res.status(500).json({ message: 'Error fetching news' });
  }
});

// GET /api/admin-media-news/:id — one item INCLUDING its image, for the edit form.
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const item = await MediaNews.findById(req.params.id).select(`${LIST_FIELDS} +image`);
    if (!item) return res.status(404).json({ message: 'News item not found' });
    res.status(200).json(item);
  } catch (err) {
    console.error('Error fetching news item:', err);
    res.status(500).json({ message: 'Error fetching news item' });
  }
});

// POST /api/admin-media-news — create.
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, url, publishedDate, blurb, image, isFeatured, isPublished } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required.' });
    }
    if (!url || !isValidUrl(url.trim())) {
      return res.status(400).json({ message: 'A valid article URL (http/https) is required.' });
    }
    const date = parseDate(publishedDate);
    if (!date) {
      return res.status(400).json({ message: 'A valid date is required.' });
    }
    if (image && !isImageDataUrl(image)) {
      return res.status(400).json({ message: 'Image must be a PNG, JPG or WebP.' });
    }
    if (image && image.length > MAX_IMAGE_CHARS) {
      return res.status(400).json({ message: 'Image is too large.' });
    }

    const featured = !!isFeatured;
    const news = new MediaNews({
      title: title.trim(),
      url: url.trim(),
      publishedDate: date,
      blurb: (blurb || '').trim(),
      image: image || '',
      hasImage: !!image,
      isFeatured: featured,
      // A featured article is always visible.
      isPublished: featured ? true : isPublished !== false,
    });
    await news.save();

    if (featured) await unfeatureOthers(news._id);

    const out = news.toObject();
    delete out.image;
    res.status(201).json(out);
  } catch (err) {
    console.error('Error creating news item:', err);
    res.status(500).json({ message: 'Error creating news item' });
  }
});

// PUT /api/admin-media-news/:id — edit.
// `image`: omit = keep as is, ''/null = remove, data URL = replace.
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const item = await MediaNews.findById(req.params.id).select('+image');
    if (!item) return res.status(404).json({ message: 'News item not found' });

    const { title, url, publishedDate, blurb, image, isFeatured, isPublished } = req.body;

    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ message: 'Title is required.' });
      item.title = title.trim();
    }
    if (url !== undefined) {
      if (!isValidUrl((url || '').trim())) {
        return res.status(400).json({ message: 'A valid article URL (http/https) is required.' });
      }
      item.url = url.trim();
    }
    if (publishedDate !== undefined) {
      const date = parseDate(publishedDate);
      if (!date) return res.status(400).json({ message: 'A valid date is required.' });
      item.publishedDate = date;
    }
    if (blurb !== undefined) item.blurb = (blurb || '').trim();

    if (image !== undefined) {
      if (!image) {
        item.image = '';
        item.hasImage = false;
      } else if (!isImageDataUrl(image)) {
        return res.status(400).json({ message: 'Image must be a PNG, JPG or WebP.' });
      } else if (image.length > MAX_IMAGE_CHARS) {
        return res.status(400).json({ message: 'Image is too large.' });
      } else {
        item.image = image;
        item.hasImage = true;
      }
    }

    if (isPublished !== undefined) item.isPublished = !!isPublished;
    if (isFeatured !== undefined) item.isFeatured = !!isFeatured;
    // Featured implies published; hiding an article un-features it.
    if (item.isFeatured) item.isPublished = true;
    if (!item.isPublished) item.isFeatured = false;

    await item.save();
    if (item.isFeatured) await unfeatureOthers(item._id);

    const out = item.toObject();
    delete out.image;
    res.status(200).json(out);
  } catch (err) {
    console.error('Error updating news item:', err);
    res.status(500).json({ message: 'Error updating news item' });
  }
});

// PUT /api/admin-media-news/:id/feature — body { isFeatured: boolean }
router.put('/:id/feature', authMiddleware, async (req, res) => {
  try {
    const makeFeatured = !!req.body.isFeatured;
    const update = makeFeatured
      ? { isFeatured: true, isPublished: true }
      : { isFeatured: false };

    const item = await MediaNews.findByIdAndUpdate(req.params.id, update, { new: true })
      .select(LIST_FIELDS);
    if (!item) return res.status(404).json({ message: 'News item not found' });

    if (makeFeatured) await unfeatureOthers(item._id);
    res.status(200).json(item);
  } catch (err) {
    console.error('Error toggling featured:', err);
    res.status(500).json({ message: 'Error updating featured status' });
  }
});

// PUT /api/admin-media-news/:id/publish — body { isPublished: boolean }
router.put('/:id/publish', authMiddleware, async (req, res) => {
  try {
    const publish = !!req.body.isPublished;
    const update = publish ? { isPublished: true } : { isPublished: false, isFeatured: false };

    const item = await MediaNews.findByIdAndUpdate(req.params.id, update, { new: true })
      .select(LIST_FIELDS);
    if (!item) return res.status(404).json({ message: 'News item not found' });
    res.status(200).json(item);
  } catch (err) {
    console.error('Error toggling publish:', err);
    res.status(500).json({ message: 'Error updating publish status' });
  }
});

// DELETE /api/admin-media-news/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await MediaNews.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'News item not found' });
    res.status(200).json({ message: 'News item deleted' });
  } catch (err) {
    console.error('Error deleting news item:', err);
    res.status(500).json({ message: 'Error deleting news item' });
  }
});

module.exports = router;