// scripts/seedMediaNews.js
// One-off: loads the six articles that are currently hardcoded in MediaPage.jsx
// so the page isn't empty the moment it goes dynamic.
//
// Run from the Backend folder:   node scripts/seedMediaNews.js
// It refuses to run if the news collection already has data.

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MediaNews = require('../Admin/models/MediaNews');

const d = (s) => new Date(`${s}T00:00:00.000Z`);

const seed = [
  {
    publishedDate: d('2026-06-18'),
    title: 'Key Outcomes of the 347th ESA Council Meeting',
    url: 'https://www.esa.int/Newsroom/Press_Releases/Key_outcomes_of_the_347th_ESA_Council_meeting',
    blurb:
      "ESA's governing council met in Paris to confirm new leadership appointments, advance its crewed mission concept, and deepen international partnerships spanning Earth observation and human spaceflight.",
    isFeatured: true,
  },
  {
    publishedDate: d('2026-06-17'),
    title: 'Advanced Health Research Continues Aboard the Space Station With AR and VR Tools',
    url: 'https://www.nasa.gov/blogs/spacestation/2026/06/17/advanced-health-research-on-station-using-augmented-virtual-reality-tools/',
  },
  {
    publishedDate: d('2026-06-17'),
    title: 'Ariane 6 Launches With More Powerful Boosters, Setting a New Record for Europe',
    url: 'https://www.esa.int/Newsroom/Press_Releases/Ariane_6_launches_with_more_powerful_boosters_a_new_record_for_Europe',
  },
  {
    publishedDate: d('2026-06-08'),
    title: 'ESA Signs an Agreement With Vast on Behalf of the Czech Republic',
    url: 'https://www.esa.int/Newsroom/Press_Releases/ESA_signs_an_Agreement_with_Vast_on_behalf_of_the_Czech_Republic',
  },
  {
    publishedDate: d('2026-03-27'),
    title: 'NASA Selects Intuitive Machines to Deliver Artemis Science and Tech to the Moon',
    url: 'https://www.nasa.gov/missions/artemis/clps/nasa-selects-intuitive-machines-to-deliver-artemis-science-tech-to-moon/',
  },
  {
    publishedDate: d('2026-03-24'),
    title: "NASA's Water-Hunting Tool Will Help Scout the Moon's South Pole",
    url: 'https://www.nasa.gov/solar-system/moon/nasas-water-hunting-tool-will-help-scout-moons-south-pole/',
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const existing = await MediaNews.countDocuments();
    if (existing > 0) {
      console.log(`News collection already has ${existing} item(s). Nothing seeded.`);
    } else {
      await MediaNews.insertMany(seed.map((s) => ({ isPublished: true, ...s })));
      console.log(`Seeded ${seed.length} news items.`);
    }
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();