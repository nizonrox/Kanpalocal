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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- cache ----------

let cache = { data: null, week: null };

function currentWeekNumber() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
}

function isCacheValid() {
  return cache.data !== null && cache.week === currentWeekNumber();
}

async function getFrontendData(forceRefresh = false) {
  if (!isCacheValid() || forceRefresh) {
    console.log(forceRefresh ? 'Force refresh — fetching from Kanpla...' : 'Cache miss — fetching from Kanpla...');
    try {
      cache.data = await kanpla.getFrontend();
    } catch (err) {
      const isTokenExpired = err?.response?.data?.message?.includes('id-token-expired');
      if (isTokenExpired) {
        console.log('Token expired — refreshing and retrying...');
        await kanpla.forceRefreshToken();
        cache.data = await kanpla.getFrontend();
      } else {
        throw err;
      }
    }
    cache.week = currentWeekNumber();
  } else {
    console.log('Cache hit — serving cached data');
  }
  return cache.data;
}

// ---------- date helpers ----------

/**
 * Convert a Unix timestamp (seconds) to a local YYYY-MM-DD string.
 * Using local time avoids the UTC-vs-local mismatch when deriving day names later.
 */
function localDateString(timestampSeconds) {
  const d = new Date(timestampSeconds * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Return the local YYYY-MM-DD strings for Monday–Friday of the current week. */
function currentWeekDates() {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;

  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + diffToMonday + i);
    return localDateString(d.getTime() / 1000); // reuse helper
  });
}

// ---------- menu parsing ----------

function parseMeals(frontendData) {
  const mealsByDate = {};

  for (const offer of Object.values(frontendData.offers ?? {})) {
    for (const item of offer.items ?? []) {
      for (const [ts, info] of Object.entries(item.dates ?? {})) {
        if (!info.available || !info.menu?.name) continue;

        const date = localDateString(parseInt(ts, 10));
        if (!mealsByDate[date]) mealsByDate[date] = new Set();
        mealsByDate[date].add(info.menu.name);
      }
    }
  }

  // Convert Sets to sorted arrays for deterministic output
  return Object.fromEntries(
    Object.entries(mealsByDate).map(([date, names]) => [date, [...names].sort().reverse()])
  );
}

// ---------- routes ----------

app.get('/', (_req, res) => {
  res.type('text/plain').send('Canteen menu server — GET /menu');
});

app.get('/menu', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const data = await getFrontendData(forceRefresh);
    const mealsByDate = parseMeals(data);
    const weekDates = currentWeekDates();

    let output = '';

    for (const date of weekDates) {
      const meals = mealsByDate[date];
      const dayName = DAY_NAMES[new Date(`${date}T12:00:00`).getDay()]; // noon avoids DST edge cases
      output += `\n📅 ${dayName}, ${date}\n${'-'.repeat(30)}\n`;

      if (!meals || meals.length === 0) {
        output += '  (no menu available)\n';
      } else {
        for (const name of meals) {
          output += `  • ${name}\n`;
        }
      }
    }

    res.type('text/plain').send(output.trim());
  } catch (err) {
    console.error('Error fetching menu:', err);
    res.status(500).type('text/plain').send('Failed to fetch menu. Check server logs.');
  }
});

// ---------- start ----------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
