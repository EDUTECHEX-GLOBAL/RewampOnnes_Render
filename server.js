const express = require('express');
const app = express();
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('path');

// Import routes
const contactRoutes = require('./Admin/routes/contactRoutes');
const adminAuthRoutes = require('./Admin/routes/adminAuthRoutes');
const subscriptionRoutes = require('./Admin/routes/subscriptionRoutes');
const visitorRoutes = require('./Admin/routes/VisitorRoute');
const weekdataRoutes = require('./Admin/routes/WeekDataRoute');
const newsletterRoutes = require('./Admin/routes/newsletterRoutes');
const publicBlogRoutes = require('./Admin/routes/publicBlogRoutes');

dotenv.config();

// Important for Render / proxies
app.set('trust proxy', 1);

// ✅ CORRECT CORS FOR VERCEL FRONTEND
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://onnes-in-frontend-vercel.vercel.app",
    "https://onnes.in",
    "https://rewamp.onnes.in",
    "https://rewamp2.onnes.in",
    "https://onnesaerospace.com",
    "https://www.onnesaerospace.com",
    "https://rewamp3.onnes.in",
    "https://onnes-new-jun-2026-lilac.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

// 🔥 VERY IMPORTANT — handle preflight
app.options("*", cors());

// Parse JSON
// Limit raised from the default (~100kb) so newsletter content with
// embedded base64 images (from the rich text editor) doesn't get rejected.
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Note: Static file serving for uploads is no longer needed for contact files
// since they are now stored in MongoDB. Keep this only if you have other 
// uploads that need static serving.
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB — tuned connection pool + timeouts so requests (like login)
// don't stall waiting on a slow/unestablished connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error("MongoDB error:", err));

// Routes
app.use('/api/admin-contact', contactRoutes);
app.use('/api/admin', adminAuthRoutes);
app.use('/api/admin-subscribe', subscriptionRoutes);
app.use('/api/admin-visitors', visitorRoutes);
app.use('/api/week-data', weekdataRoutes);
app.use('/api/admin-newsletter', newsletterRoutes);
app.use('/api/blog', publicBlogRoutes); // public, unauthenticated — backs the website's /blogs pages

// Health check (general API status)
app.get("/api", (req, res) => {
  res.json({ status: "Backend is running" });
});

// Dedicated lightweight health/keep-alive endpoint (for cron-job.org pings)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});