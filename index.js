require('dotenv').config({ quiet: true });
const { Kanpla } = require('@datagutt/kanpla');
const express = require('express');

const app = express();

const kanpla = new Kanpla({
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
  FIREBASE_USERNAME: process.env.FIREBASE_USERNAME,
  FIREBASE_PASSWORD: process.env.FIREBASE_PASSWORD,
  MODULE_ID: process.env.MODULE_ID,
  LANGUAGE: 'da',
});

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let cache = { data: null, week: null };

function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function isCacheValid() {
  return !!(cache.data && cache.week === getWeekNumber(new Date()));
}

app.get('/menu', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';

    if (!isCacheValid() || forceRefresh) {
      console.log(forceRefresh ? 'Force refresh — fetching from Kanpla...' : 'Cache miss — fetching from Kanpla...');
      cache.data = await kanpla.getFrontend();
      cache.week = getWeekNumber(new Date());
    } else {
      console.log('Cache hit — serving cached data');
    }

    const mealsByDate = {};

    for (const offer of Object.values(cache.data.offers || {})) {
      for (const item of offer.items || []) {
        for (const [ts, info] of Object.entries(item.dates || {})) {
          if (!info.available || !info.menu?.name) continue;

          const date = new Date(parseInt(ts) * 1000).toISOString().split('T')[0];
          if (!mealsByDate[date]) mealsByDate[date] = [];

          if (!mealsByDate[date].find(m => m.name === info.menu.name)) {
            mealsByDate[date].push({ name: info.menu.name });
          }
        }
      }
    }

const today = new Date();

// Get Monday of current week
const startOfWeek = new Date(today);
const day = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
const diffToMonday = day === 0 ? -6 : 1 - day;
startOfWeek.setDate(today.getDate() + diffToMonday);

// Get Sunday of current week
const endOfWeek = new Date(startOfWeek);
endOfWeek.setDate(startOfWeek.getDate() + 6);

const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

let output = '';

for (const date of Object.keys(mealsByDate).sort()) {
  if (date < startOfWeekStr || date > endOfWeekStr) continue;

  output += `\n📅 ${DAYS[new Date(date).getDay()]}, ${date}\n${'-'.repeat(30)}\n`;

  for (const meal of mealsByDate[date]) {
    output += `  • ${meal.name}\n`;
  }
}

    res.type('text/plain').send(output);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch menu');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));