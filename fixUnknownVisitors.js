// ✅ One-time script to fix existing "Unknown" visitor records in MongoDB
// Run this script ONCE from your backend folder:
//   node fixUnknownVisitors.js
//
// It will:
//   1. Find all visitors where any field is "Unknown"
//   2. Group them by IP (to avoid duplicate API calls)
//   3. Call ip-api.com in batches of 40/min (safe under 45/min limit)
//   4. Update all matching records in MongoDB with correct geo data

const mongoose = require('mongoose');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

// ✅ Import your Visitor model
const Visitor = require('./Admin/models/Visitor'); // adjust path if needed

// ✅ MongoDB connection
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env file');
  process.exit(1);
}

// ✅ Sleep helper (ms)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ✅ Fetch geo data for a single IP from ip-api.com
const fetchGeo = async (ip) => {
  try {
    const response = await axios.get(
      `http://ip-api.com/json/${ip}?fields=status,message,city,regionName,country,zip`,
      { timeout: 7000 }
    );

    if (response.data && response.data.status === 'success') {
      return {
        city: response.data.city || 'Unknown',
        region: response.data.regionName || 'Unknown',
        country: response.data.country || 'Unknown',
        postalCode: response.data.zip || 'Unknown',
      };
    } else {
      console.warn(`  ⚠️  ip-api non-success for ${ip}:`, response.data?.message);
      return null;
    }
  } catch (err) {
    console.warn(`  ⚠️  API call failed for ${ip}:`, err.message);
    return null;
  }
};

const run = async () => {
  try {
    // ✅ Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // ✅ Find all records where ANY field is "Unknown"
    const unknownVisitors = await Visitor.find({
      $or: [
        { city: 'Unknown' },
        { region: 'Unknown' },
        { country: 'Unknown' },
        { postalCode: 'Unknown' },
      ]
    }).lean();

    console.log(`📋 Found ${unknownVisitors.length} records with "Unknown" fields\n`);

    if (unknownVisitors.length === 0) {
      console.log('🎉 Nothing to fix! All records already have geo data.');
      process.exit(0);
    }

    // ✅ Group records by IP to avoid duplicate API calls
    const ipMap = new Map(); // { ip -> [_id, _id, ...] }
    for (const visitor of unknownVisitors) {
      if (!ipMap.has(visitor.ip)) {
        ipMap.set(visitor.ip, []);
      }
      ipMap.get(visitor.ip).push(visitor._id);
    }

    const uniqueIps = [...ipMap.keys()];
    console.log(`🌐 Unique IPs to look up: ${uniqueIps.length}\n`);

    // ✅ Process in batches of 40 per minute (safe under ip-api's 45/min limit)
    const BATCH_SIZE = 40;
    const BATCH_DELAY_MS = 60 * 1000; // 1 minute between batches

    let totalUpdated = 0;
    let totalFailed = 0;
    let batchNum = 0;

    for (let i = 0; i < uniqueIps.length; i += BATCH_SIZE) {
      batchNum++;
      const batch = uniqueIps.slice(i, i + BATCH_SIZE);
      console.log(`\n🔄 Batch ${batchNum}: processing ${batch.length} IPs (${i + 1}–${Math.min(i + BATCH_SIZE, uniqueIps.length)} of ${uniqueIps.length})`);

      for (const ip of batch) {
        const ids = ipMap.get(ip);
        console.log(`  📍 Looking up IP: ${ip} (${ids.length} record(s))`);

        const geo = await fetchGeo(ip);

        if (geo) {
          // ✅ Update ALL records with this IP at once
          const result = await Visitor.updateMany(
            {
              _id: { $in: ids },
              $or: [
                { city: 'Unknown' },
                { region: 'Unknown' },
                { country: 'Unknown' },
                { postalCode: 'Unknown' },
              ]
            },
            {
              $set: {
                city: geo.city,
                region: geo.region,
                country: geo.country,
                postalCode: geo.postalCode,
              }
            }
          );

          console.log(`  ✅ Updated ${result.modifiedCount} record(s) → ${geo.city}, ${geo.region}, ${geo.country}`);
          totalUpdated += result.modifiedCount;
        } else {
          console.log(`  ❌ Could not get geo for ${ip} — skipping (${ids.length} record(s) left as-is)`);
          totalFailed += ids.length;
        }

        // ✅ Small delay between each IP call (300ms) to be gentle on the API
        await sleep(300);
      }

      // ✅ Wait 1 minute between batches (except after last batch)
      if (i + BATCH_SIZE < uniqueIps.length) {
        console.log(`\n⏳ Waiting 60 seconds before next batch to respect ip-api rate limit...`);
        await sleep(BATCH_DELAY_MS);
      }
    }

    // ✅ Summary
    console.log('\n========================================');
    console.log('✅ Fix script completed!');
    console.log(`   Total records updated : ${totalUpdated}`);
    console.log(`   Total records failed  : ${totalFailed}`);
    console.log(`   Total IPs processed   : ${uniqueIps.length}`);
    console.log('========================================\n');

    process.exit(0);

  } catch (err) {
    console.error('❌ Script error:', err.message);
    process.exit(1);
  }
};

run();

//run node fixUnknownVisitors.js in backend folder if unknown ips shown