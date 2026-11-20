// Admin/models/SystemBrochure.js
// One document per Systems & Solutions system (keyed by its URL slug).
// The PDF is ALWAYS kept in MongoDB (fileData) as the safety copy, and is
// additionally uploaded to Cloudinary when possible (cloudinaryUrl).

const mongoose = require('mongoose');

const systemBrochureSchema = new mongoose.Schema({
    // Matches the slug in the frontend's systemsSolutionsData.js
    slug: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        maxlength: 100
    },
    fileName: {
        type: String,
        default: 'brochure.pdf',
        trim: true
    },
    fileSize: {
        type: Number,
        default: 0
    },
    // select:false keeps the heavy binary out of every query unless it is
    // explicitly requested with .select('+fileData').
    fileData: {
        type: Buffer,
        select: false
    },
    // Empty string = not (or no longer) available on Cloudinary.
    cloudinaryUrl: {
        type: String,
        default: ''
    },
    // Last Cloudinary failure reason, shown in the admin screen.
    cloudinaryError: {
        type: String,
        default: ''
    }
}, { timestamps: true });

module.exports = mongoose.model('SystemBrochure', systemBrochureSchema);