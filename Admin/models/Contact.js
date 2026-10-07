const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  fullName: String,
  email: String,
  organization: String,
  mobile: String,
  country: String,
  product: String,
  interest: String,
  projectStage: String,
  message: String,

  fileData: Buffer,
  fileName: String,
  fileSize: Number,
  fileMimeType: String,

  createdAt: {
    type: Date,
    default: Date.now,
    index: true // ✅ indexed
  }
});

module.exports = mongoose.model('Contact', contactSchema);