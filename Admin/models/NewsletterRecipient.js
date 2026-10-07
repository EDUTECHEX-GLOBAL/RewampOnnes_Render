const mongoose = require('mongoose');

const newsletterRecipientSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: '',
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  category: {
    type: String,
    enum: ['client', 'investor'],
    required: true,
  },
  status: {
    type: String,
    enum: ['existing', 'future'],
    required: true,
  },
}, { timestamps: true });

// Same email can appear once per category (e.g. once as client, once as investor)
// but not twice within the same category.
newsletterRecipientSchema.index({ email: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('NewsletterRecipient', newsletterRecipientSchema);