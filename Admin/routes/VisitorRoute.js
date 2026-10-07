// ✅ Updated Visitor route.js — uses ip-api.com with in-memory geo cache
// + filters out known cloud-hosting/bot traffic (AWS, GCP, Azure, etc.) and bot user-agents

const express = require('express');
const axios = require('axios');
const requestIp = require('request-ip');
const Visitor = require('../models/Visitor');
const dotenv = require('dotenv');

dotenv.config();

const router = express.Router();

const geoCache = new Map();
const GEO_CACHE_TTL_MS = 10 * 60 * 1000;

// Known cloud/hosting/datacenter providers — real visitors don't come from these
const HOSTING_KEYWORDS = [
  'amazon', 'aws', 'google cloud', 'google llc', 'microsoft azure',
  'digitalocean', 'linode', 'ovh', 'hetzner', 'oracle cloud',
  'alibaba cloud', 'cloudflare', 'fastly', 'akamai', 'render.com',
  'vercel', 'contabo', 'vultr',
];

// Known bot / crawler / monitoring User-Agent signatures
const BOT_UA_PATTERNS = [
  /bot/i, /spider/i, /crawl/i, /slurp/i, /headless/i,
  /python-requests/i, /curl/i, /wget/i, /go-http-client/i,
  /uptimerobot/i, /pingdom/i, /statuscake/i, /monitor/i,
];

const getGeoData = async (ip) => {
  const now = Date.now();

  if (geoCache.has(ip)) {
    const cached = geoCache.get(ip);
    if (now < cached.expiresAt) {
      console.log(`✅ Geo cache hit for IP: ${ip}`);
      return cached.data;
    } else {
      geoCache.delete(ip);
    }
  }

  let geoData = {
    city: 'Unknown',
    region: 'Unknown',
    country: 'Unknown',
    postal: 'Unknown',
    org: '',
  };

  try {
    const response = await axios.get(
      `http://ip-api.com/json/${ip}?fields=status,message,city,regionName,country,zip,org,isp,as`,
      { timeout: 5000 }
    );

    if (response.data && response.data.status === 'success') {
      geoData = {
        city: response.data.city || 'Unknown',
        region: response.data.regionName || 'Unknown',
        country: response.data.country || 'Unknown',
        postal: response.data.zip || 'Unknown',
        // Combine org/isp/as so keyword matching catches whichever field has the provider name
        org: `${response.data.org || ''} ${response.data.isp || ''} ${response.data.as || ''}`.toLowerCase(),
      };
      console.log(`✅ IP lookup success: ${geoData.city}, ${geoData.region}, ${geoData.country}`);
    } else {
      console.warn(`⚠️ ip-api returned non-success for ${ip}:`, response.data?.message || 'Unknown reason');
    }
  } catch (ipLookupError) {
    console.warn(`⚠️ IP lookup failed for ${ip}:`, ipLookupError.message);
  }

  geoCache.set(ip, {
    data: geoData,
    expiresAt: now + GEO_CACHE_TTL_MS,
  });

  return geoData;
};

const isHostingProvider = (orgString) => {
  if (!orgString) return false;
  return HOSTING_KEYWORDS.some((keyword) => orgString.includes(keyword));
};

const isBotUserAgent = (userAgent) => {
  if (!userAgent) return false;
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
};

// ✅ GET all visitors — now paginated (default 200, max 500) instead of unbounded
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const skip = parseInt(req.query.skip) || 0;

    const visitors = await Visitor.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json(visitors);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch visitors', error });
  }
});

// ✅ NEW: Get weekly country statistics
router.get('/weekly-country-stats', async (req, res) => {
  try {
    const now = new Date();
    const startCurrent = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startPrevious = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Get current week's country counts
    const currentWeekCountries = await Visitor.aggregate([
      {
        $match: {
          createdAt: { $gte: startCurrent }
        }
      },
      {
        $group: {
          _id: '$country',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get previous week's country counts
    const previousWeekCountries = await Visitor.aggregate([
      {
        $match: {
          createdAt: { $gte: startPrevious, $lt: startCurrent }
        }
      },
      {
        $group: {
          _id: '$country',
          count: { $sum: 1 }
        }
      }
    ]);

    // Create a map for previous week counts
    const prevMap = {};
    previousWeekCountries.forEach(item => {
      prevMap[item._id] = item.count;
    });

    // Combine data with week-over-week change
    const result = currentWeekCountries.map(item => {
      const prevCount = prevMap[item._id] || 0;
      const change = prevCount === 0 ? null : ((item.count - prevCount) / prevCount) * 100;
      return {
        country: item._id || 'Unknown',
        count: item.count,
        previousWeek: prevCount,
        change: change,
        trend: change === null ? 'new' : change > 0 ? 'up' : change < 0 ? 'down' : 'same'
      };
    });

    // Get total current week visitors
    const totalCurrent = currentWeekCountries.reduce((sum, item) => sum + item.count, 0);
    const totalPrevious = previousWeekCountries.reduce((sum, item) => sum + item.count, 0);

    res.json({
      data: result,
      total: {
        current: totalCurrent,
        previous: totalPrevious,
        change: totalPrevious === 0 ? null : ((totalCurrent - totalPrevious) / totalPrevious) * 100
      }
    });
  } catch (error) {
    console.error('Error fetching weekly country stats:', error);
    res.status(500).json({ message: 'Failed to fetch weekly country statistics', error });
  }
});

// ✅ Log visitor data
router.post('/admin-visitor', async (req, res) => {
  try {
    let clientIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.ip ||
      requestIp.getClientIp(req);

    if (clientIp?.includes('::ffff:')) {
      clientIp = clientIp.split('::ffff:')[1];
    }

    const isLocalhost = ['::1', '127.0.0.1', '0.0.0.0'].includes(clientIp);
    const isPrivateIp = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(clientIp);

    if (isLocalhost || isPrivateIp) {
      console.log(`Ignored IP: ${clientIp}`);
      return res.status(200).send('Private/Localhost IP ignored');
    }

    // Skip known bot/crawler user-agents
    const userAgent = req.headers['user-agent'] || '';
    if (isBotUserAgent(userAgent)) {
      console.log(`Ignored bot UA: ${userAgent}`);
      return res.status(200).send('Bot user-agent ignored');
    }

    console.log(`Logging visitor with IP: ${clientIp}`);

    const { city, region, country, postal, org } = await getGeoData(clientIp);

    // Skip known cloud/hosting providers (AWS, GCP, Azure, etc.) — not real visitors
    if (isHostingProvider(org)) {
      console.log(`Ignored hosting-provider IP: ${clientIp} (${org})`);
      return res.status(200).send('Hosting-provider IP ignored');
    }

    const newVisitor = new Visitor({
      ip: clientIp || '0.0.0.0',
      city,
      region,
      postalCode: postal,
      country,
    });

    await newVisitor.save();
    res.status(200).send('Visitor data logged successfully!');

  } catch (err) {
    console.error("Error logging visitor:", err.message);
    res.status(500).send('Error logging visitor data');
  }
});

// ✅ Count route
router.get('/count', async (req, res) => {
  try {
    const count = await Visitor.countDocuments();
    res.status(200).json({ count });
  } catch (err) {
    console.error("Error fetching visitor count", err);
    res.status(500).send('Error fetching visitor count');
  }
});

module.exports = router;