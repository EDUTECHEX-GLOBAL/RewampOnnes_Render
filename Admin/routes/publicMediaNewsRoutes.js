// Admin/routes/publicMediaNewsRoutes.js
// Mounted at /api/media-news — public, unauthenticated. Backs the website's /media page.
//
// GET /            -> { featured, items }   (published only)
// GET /:id/image   -> compressed featured image (served as a real image URL,
//                     so the JSON list never carries base64 data)

const express = require('express');
const mongoose = require('mongoose');
const sharp = require('sharp');
const router = express.Router();
const MediaNews = require('../models/MediaNews');

const PUBLIC_FIELDS = 'title url publishedDate blurb hasImage updatedAt';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Mount path, used to build image URLs the frontend can load directly.
const MOUNT_PATH = '/api/media-news';

function shape(n) {
  return {
    id: n._id,
    title: n.title,
    url: n.url,
    date: n.publishedDate,
    blurb: n.blurb || '',
    // ?v= changes whenever the article is edited, so the long-lived
    // browser cache below never serves a stale image.
    imageUrl: n.hasImage
      ? `${MOUNT_PATH}/${n._id}/image?v=${new Date(n.updatedAt).getTime()}`
      : null,
  };
}

// GET /api/media-news
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const sort = { publishedDate: -1, createdAt: -1 };

    // Featured = the one the admin starred; if none, fall back to the newest.
    let featured = await MediaNews.findOne({ isPublished: true, isFeatured: true })
      .select(PUBLIC_FIELDS)
      .lean();
    if (!featured) {
      featured = await MediaNews.findOne({ isPublished: true })
        .select(PUBLIC_FIELDS)
        .sort(sort)
        .lean();
    }

    if (!featured) {
      return res.status(200).json({ featured: null, items: [] });
    }

    const items = await MediaNews.find({ isPublished: true, _id: { $ne: featured._id } })
      .select(PUBLIC_FIELDS)
      .sort(sort)
      .limit(limit)
      .lean();

    res.status(200).json({ featured: shape(featured), items: items.map(shape) });
  } catch (err) {
    console.error('Error fetching public news:', err);
    res.status(500).json({ message: 'Error fetching news' });
  }
});

// Small in-memory cache of compressed images (cleared on restart).
const IMAGE_CACHE_MAX = 50;
const imageCache = new Map();

function cacheImage(key, value) {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    imageCache.delete(imageCache.keys().next().value);
  }
  imageCache.set(key, value);
}

// GET /api/media-news/:id/image
router.get('/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).end();

    const item = await MediaNews.findOne({ _id: id, isPublished: true })
      .select('+image hasImage updatedAt');
    if (!item || !item.hasImage || !item.image) return res.status(404).end();

    const cacheKey = `${id}:${new Date(item.updatedAt).getTime()}`;
    let cached = imageCache.get(cacheKey);

    if (!cached) {
      const match = item.image.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) return res.status(404).end();

      const original = Buffer.from(match[2], 'base64');
      try {
        const buffer = await sharp(original)
          .resize({ width: 1000, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        cached = { buffer, mimeType: 'image/webp' };
      } catch (compressErr) {
        console.error('News image compression failed, serving original:', compressErr.message);
        cached = { buffer: original, mimeType: match[1] };
      }
      cacheImage(cacheKey, cached);
    }

    res.set('Content-Type', cached.mimeType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(cached.buffer);
  } catch (err) {
    console.error('Error serving news image:', err);
    res.status(500).end();
  }
});

module.exports = router;