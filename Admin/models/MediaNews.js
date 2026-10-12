// Admin/models/MediaNews.js

const mongoose = require('mongoose');

const mediaNewsSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 300
    },
    // External article link (NASA, ESA, ...). "Read More" opens this in a new tab.
    url: {
        type: String,
        required: true,
        trim: true
    },
    // Stored at UTC midnight so the displayed day never shifts with timezone.
    publishedDate: {
        type: Date,
        required: true
    },
    // Short summary — only shown on the featured card.
    blurb: {
        type: String,
        default: '',
        trim: true,
        maxlength: 600
    },
    // Base64 data URL. select:false keeps it out of every query unless
    // explicitly requested with .select('+image'), so list responses stay small.
    image: {
        type: String,
        default: '',
        select: false
    },
    hasImage: {
        type: Boolean,
        default: false
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    isPublished: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

mediaNewsSchema.index({ isPublished: 1, publishedDate: -1 });

module.exports = mongoose.model('MediaNews', mediaNewsSchema);