const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const { scoreImpact } = require('./classifier');
const { sendNotification } = require('./notifier');

const parser = new Parser();
const SEEN_FILE = path.join(__dirname, '../data/seen.json');

const SOURCES = [
  { type: 'rss', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'general' },
  { type: 'rss', url: 'https://rss.cnn.com/rss/edition.rss', category: 'general' },
  { type: 'rss', url: 'https://www.reuters.com/rssFeed/topNews/', category: 'general' },
  // Removed API sources to avoid keys
];

async function loadSeen() {
  try {
    const data = fs.readFileSync(SEEN_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
}

async function fetchRSS(url) {
  const feed = await parser.parseURL(url);
  return feed.items.map(item => ({
    title: item.title,
    summary: item.contentSnippet || item.summary,
    link: item.link,
    pubDate: item.pubDate,
    source: url
  }));
}

async function fetchAPI(url) {
  // Removed API fetching
  return [];
}

async function monitorSources() {
  const seen = await loadSeen();
  const newItems = [];

  for (const source of SOURCES) {
    try {
      let items = [];
      if (source.type === 'rss') {
        items = await fetchRSS(source.url);
      } else if (source.type === 'api') {
        items = await fetchAPI(source.url);
      }

      for (const item of items) {
        if (!seen.includes(item.link)) {
          newItems.push(item);
          seen.push(item.link);
        }
      }
    } catch (error) {
      console.error(`Error fetching ${source.url}:`, error.message);
    }
  }

  await saveSeen(seen);

  // Process new items
  for (const item of newItems) {
    const score = await scoreImpact(item);
    if (score > 70) { // Threshold
      await sendNotification(item, score);
    }
  }

  console.log(`Processed ${newItems.length} new items`);
}

module.exports = { monitorSources };