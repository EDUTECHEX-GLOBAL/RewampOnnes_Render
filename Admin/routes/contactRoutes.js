const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const Contact = require('../models/Contact');
const sendMail = require('../utils/mailer');
const mongoose = require('mongoose');

const recentSubmissions = new Set();

function escapeHTML(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getISTTime() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }) + " (IST)";
}

const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, and PPTX files are accepted.'));
    }
  },
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error("❌ File upload error:", err.message);
      return res.status(400).json({ message: err.message || "File upload failed" });
    }
    next();
  });
}

//////////////////////////////////////////////////////////////////
// COUNT ROUTE
//////////////////////////////////////////////////////////////////

router.get('/count', async (req, res) => {
  try {
    const count = await Contact.countDocuments();
    res.status(200).json({ count });
  } catch (err) {
    console.error("❌ Error fetching contact count:", err);
    res.status(500).json({
      message: "Error fetching contact count"
    });
  }
});

//////////////////////////////////////////////////////////////////
// GET ALL CONTACTS — ✅ excludes fileData (heavy binary field)
//////////////////////////////////////////////////////////////////

router.get('/', async (req, res) => {
  try {
    const contacts = await Contact.find()
      .select('-fileData')
      .sort({ createdAt: -1 });
    res.status(200).json(contacts);
  } catch (error) {
    console.error("❌ Error fetching contacts:", error);
    res.status(500).json({
      message: "Error fetching contact messages"
    });
  }
});

//////////////////////////////////////////////////////////////////
// DOWNLOAD FILE BY ID — unchanged, still fetches fileData directly
//////////////////////////////////////////////////////////////////

router.get('/file/:id', async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);

    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    if (!contact.fileData) {
      return res.status(404).json({ message: "File not found" });
    }

    const fileName = contact.fileName || 'document.pdf';
    const mimeType = contact.fileMimeType || 'application/pdf';

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', contact.fileData.length);
    res.send(contact.fileData);

  } catch (error) {
    console.error("❌ Error fetching file:", error);
    res.status(500).json({ message: "Error fetching file" });
  }
});

//////////////////////////////////////////////////////////////////
// POST NEW CONTACT
//////////////////////////////////////////////////////////////////

router.post('/', handleUpload, async (req, res) => {
  console.log("📧 POST /contact route called at:", getISTTime());

  try {
    const {
      fullName,
      email,
      organization,
      product,
      mobile,
      country,
      interest,
      projectStage,
      message,
    } = req.body;

    if (!fullName || !email || !message) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const submissionId = `${email}-${mobile || ''}-${Date.now()}`;
    const duplicateKey = `${email}-${(mobile || '').trim()}-${message.substring(0, 50)}`;

    if (recentSubmissions.has(duplicateKey)) {
      console.log("⚠️ Duplicate submission detected");
      return res.status(200).json({
        message: "Contact message already received recently!"
      });
    }

    recentSubmissions.add(duplicateKey);
    setTimeout(() => {
      recentSubmissions.delete(duplicateKey);
    }, 5 * 60 * 1000);

    const fileData = req.file ? {
      fileData: req.file.buffer,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileMimeType: req.file.mimetype,
    } : {};

    const newContact = new Contact({
      fullName,
      email,
      organization,
      mobile,
      country,
      product,
      interest,
      projectStage,
      message,
      ...fileData,
    });

    await newContact.save();
    console.log("✅ Contact saved with file in MongoDB");

    res.status(201).json({
      message: "Contact saved successfully",
      submissionId
    });

    setImmediate(async () => {
      try {
        const subject = `Onnes - New Enquiry from ${fullName}`;
        const submissionTime = getISTTime();
        const escapedMessage = escapeHTML(message).replace(/(.{100})/g, "$1<br/>");

        const htmlContent = `
          <h3>New contact message</h3>
          <p><b>Name:</b> ${escapeHTML(fullName)}</p>
          <p><b>Email:</b> ${escapeHTML(email)}</p>
          <p><b>Organization:</b> ${escapeHTML(organization || '')}</p>
          <p><b>Phone:</b> ${escapeHTML(mobile || '')}</p>
          <p><b>Country:</b> ${escapeHTML(country || '')}</p>
          <p><b>Area of Interest:</b> ${escapeHTML(product || '')}</p>
          <p><b>Project Stage:</b> ${escapeHTML(projectStage || '')}</p>
          ${req.file ? `<p><b>Attachment:</b> ${escapeHTML(req.file.originalname)} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)</p>` : ''}
          <pre>${escapedMessage}</pre>
          <p><b>Time:</b> ${submissionTime}</p>
        `;

        const plainText = `
New contact message

Name: ${fullName}
Email: ${email}
Organization: ${organization || ''}
Phone: ${mobile || ''}
Country: ${country || ''}
Area of Interest: ${product || ''}
Project Stage: ${projectStage || ''}
${req.file ? `Attachment: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)\n` : ''}
Message:
${message}

Time: ${submissionTime}
        `;

        const logoPath = path.join(__dirname, "../utils/onnes-logo.jpg");
        const attachments = [];

        if (fs.existsSync(logoPath)) {
          attachments.push({
            filename: "onnes-logo.jpg",
            path: logoPath,
            cid: "companyLogo"
          });
        }

        if (req.file) {
          attachments.push({
            filename: req.file.originalname,
            content: req.file.buffer,
            contentType: req.file.mimetype,
          });
        }

        const recipients = [
          process.env.TEST_EMAIL_1,
          process.env.TEST_EMAIL_2,
        ].filter(Boolean);

        for (let i = 0; i < recipients.length; i++) {
          await sendMail(
            recipients[i],
            subject,
            htmlContent,
            attachments,
            plainText
          );
        }

        console.log("✅ Emails sent");

      } catch (mailError) {
        console.error("❌ Mail error:", mailError);
      }
    });

  } catch (error) {
    console.error("❌ Contact save error:", error);
    res.status(500).json({
      message: "Error saving contact",
      debug: error.message,
      errorName: error.name
    });
  }
});

module.exports = router;