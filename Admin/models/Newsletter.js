const mongoose = require('mongoose');

const contributorSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    // Raw base64 data URL, kept so resend-to-failed can rebuild the email
    // later without the admin re-uploading photos.
    photo: { type: String, default: '' },
  },
  { _id: false }
);

const socialLinksSchema = new mongoose.Schema(
  {
    website: { type: String, default: '' },
    contact: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    youtube: { type: String, default: '' },
  },
  { _id: false }
);

const newsletterSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['generic', 'project_updates'],
    required: true,
  },
  subject: {
    type: String,
    required: true,
  },

  headline: {
    type: String,
    default: '',
  },

  // Starburst-style structured fields.
  tagline: {
    type: String,
    default: '',
  },
  introText: {
    type: String,
    default: '',
  },
  // Raw base64 data URL for the intro/side image. Kept for resend rebuild.
  introImage: {
    type: String,
    default: '',
  },
  subheading: {
    type: String,
    default: '',
  },
  highlightsTitle: {
    type: String,
    default: '',
  },
  highlights: {
    type: [String],
    default: [],
  },
  authorNote: {
    type: String,
    default: '',
  },
  contributors: {
    type: [contributorSchema],
    default: [],
  },
  socialLinks: {
    type: socialLinksSchema,
    default: () => ({}),
  },

  bodyText: {
    type: String,
    default: '',
  },
  ctaText: {
    type: String,
    default: '',
  },
  ctaLink: {
    type: String,
    default: '',
  },

  // Raw editor HTML (base64 images included) for the "Additional Content"
  // block at send time. This is now the FULL ARTICLE BODY — it is
  // deliberately never rendered inside the sent email (see
  // newsletterRoutes.js), only on the article page and in the dashboard's
  // own stored htmlContent preview. Needed so "resend to failed
  // recipients" can rebuild things later, and so the article page can
  // render the same content on the website.
  bodyHtml: {
    type: String,
    default: '',
  },

  // Set whenever the newsletter has real "Additional Content" (bodyHtml)
  // to show — this is what gives it an article page at /blogs/:slug.
  // Both 'generic' and 'project_updates' newsletters can have a slug now;
  // the difference is exposure, not existence of the page itself:
  //   - 'generic'         -> also shown on the public /blogs listing,
  //                          permanent (no expiresAt)
  //   - 'project_updates' -> never listed (publicBlogRoutes' GET / only
  //                          returns 'generic'), reachable only via the
  //                          exact link sent in that newsletter's email,
  //                          and expires after
  //                          PROJECT_UPDATE_LINK_EXPIRY_DAYS (see
  //                          expiresAt below and newsletterRoutes.js)
  //
  // Deliberately NO `default: ''` here. If this field isn't explicitly
  // assigned, it stays completely absent (undefined) on the document.
  // That's required for the sparse unique index below to correctly skip
  // every newsletter with no article page, instead of treating them all
  // as duplicates of the same slug: "" value.
  slug: {
    type: String,
  },

  // Only set for 'project_updates' newsletters that got a slug above.
  // Once past this timestamp, the public, unauthenticated
  // GET /api/blog/:slug route returns 410 Gone instead of the article,
  // and the article page renders an "expired" state. 'generic' newsletters
  // are the permanent public blog and never get this set.
  expiresAt: {
    type: Date,
  },

  htmlContent: {
    type: String,
    required: true,
  },
  audience: {
    type: [String],
    default: [],
  },
  totalRecipients: {
    type: Number,
    default: 0,
  },
  sentCount: {
    type: Number,
    default: 0,
  },
  failedEmails: {
    type: [String],
    default: [],
  },
  status: {
    type: String,
    enum: ['sending', 'completed', 'completed_with_errors', 'failed'],
    default: 'sending',
  },
}, { timestamps: true });

newsletterSchema.index({ slug: 1 }, { unique: true, sparse: true });

// Every /history call sorts by createdAt with no filter — this index lets
// MongoDB walk documents in that order instead of doing an in-memory sort
// of the whole collection. Added while investigating a 30s timeout on
// GET /history as the collection grows with more sent newsletters.
newsletterSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Newsletter', newsletterSchema);