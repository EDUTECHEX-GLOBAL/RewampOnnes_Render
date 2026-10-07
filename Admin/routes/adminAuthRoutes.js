// Admin/routes/adminAuthRoutes.js

const express = require('express');
const router = express.Router();
const { loginAdmin } = require('../controllers/adminAuthController');

// @route POST /

router.post('/login', loginAdmin);

module.exports = router;
