const express = require('express');
const router = express.Router();
const Newsletter = require('../models/Newsletter');

// Public, unauthenticated routes — these back the website's /blogs pages.
//
// GET /        (listing) only ever returns 'generic' newsletters — this is
//              what powers the public Blogs page, so 'project_updates'
//              (Clients & Investors only) never appear there.
// GET /:slug   (single article) returns EITHER type. 'project_updates'
//              articles are still never listed or linked from anywhere
//              public — the only way to reach one is with the exact slug,
//              which is the same link sent in that newsletter's email —
//              and they expire (see expiresAt), unlike 'generic' articles,
//              which are permanent.

// Fallback for older/edge-case posts that don't have a dedicated
// introImage set — pulls the first <img> out of the body HTML instead.
// Newer posts (composed after the intro-image field was added) will
// always have introImage set directly, so this rarely runs.
function extractFirstImage(html = '') {
  const match = html.match(/<img[^>]*src=(["'])(.*?)\1[^>]*>/i);
  return match ? match[2] : null;
}

// "Company Update" / "Project Update" — computed here once so the
// frontend doesn't need its own fallback map to stay in sync with this
// list if a third type is ever added.
const EYEBROWS = {
  generic: 'Company Update',
  project_updates: 'Project Update',
};

// ~200 words/minute, same rule of thumb the frontend's own fallback used —
// computed here so the article page and any future consumer (an RSS feed,
// a share card) all agree on one number instead of each estimating it.
function estimateReadMinutes(html = '') {
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// GET /api/blog — list, for the Blogs listing page.
router.get('/', async (req, res) => {
  try {
    const posts = await Newsletter.find({
      type: 'generic',
      slug: { $ne: '' },
      bodyHtml: { $ne: '' },
    })
      .select('subject headline bodyText bodyHtml introImage slug createdAt')
      .sort({ createdAt: -1 });

    const result = posts.map((p) => ({
      slug: p.slug,
      title: p.headline || p.subject,
      excerpt: (p.bodyText || '').slice(0, 180),
      date: p.createdAt,
      heroImage: p.introImage || extractFirstImage(p.bodyHtml || ''),
    }));

    res.status(200).json({ posts: result });
  } catch (err) {
    console.error('Error fetching public blog list:', err);
    res.status(500).json({ message: 'Error fetching blog posts' });
  }
});

// GET /api/blog/:slug — a single article, for the Blog post page.
// Returns EVERY structured section of the newsletter (not just bodyHtml)
// so the article page can render the same full layout the email
// used to have — tagline, intro, highlights, author's note, contributors,
// socials — restyled for the web instead of the email's table-based HTML.
router.get('/:slug', async (req, res) => {
  try {
    const post = await Newsletter.findOne({
      slug: req.params.slug,
    }).select(
      'type subject headline tagline introText introImage subheading bodyHtml ' +
      'highlightsTitle highlights ctaText ctaLink authorNote contributors ' +
      'socialLinks slug expiresAt createdAt'
    );

    if (!post || !post.bodyHtml) {
      return res.status(404).json({ message: 'Article not found' });
    }

    if (post.expiresAt && post.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: 'This article link has expired.', expired: true });
    }

    // The email's CTA defaults to this very article's own URL (see
    // finalCtaLink in newsletterRoutes.js) — that's the right thing to
    // show a reader in their inbox, but showing "Read the Full Update" on
    // the page they're already reading, linking right back to itself,
    // makes no sense. Suppress the CTA on the article page specifically
    // when it points at the page itself. A CUSTOM cta the admin typed
    // that happens to point elsewhere is left alone.
    const isSelfLinkCta = !!(
      post.ctaLink && post.ctaLink.replace(/\/+$/, '').endsWith(`/blogs/${post.slug}`)
    );

    res.status(200).json({
      slug: post.slug,
      type: post.type,
      eyebrow: EYEBROWS[post.type] || 'Company Update',
      readMinutes: estimateReadMinutes(post.bodyHtml),
      title: post.headline || post.subject,
      date: post.createdAt,
      tagline: post.tagline || '',
      introText: post.introText || '',
      introImage: post.introImage || null,
      subheading: post.subheading || '',
      heroImage: post.introImage || extractFirstImage(post.bodyHtml),
      bodyHtml: post.bodyHtml,
      highlightsTitle: post.highlightsTitle || '',
      highlights: post.highlights || [],
      ctaText: isSelfLinkCta ? '' : (post.ctaText || ''),
      ctaLink: isSelfLinkCta ? '' : (post.ctaLink || ''),
      authorNote: post.authorNote || '',
      contributors: post.contributors || [],
      socialLinks: post.socialLinks || {},
    });
  } catch (err) {
    console.error('Error fetching public blog post:', err);
    res.status(500).json({ message: 'Error fetching blog post' });
  }
});

module.exports = router;