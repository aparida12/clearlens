require('dotenv').config();
const fs = require('fs');
const path = require('path');
const RSSParser = require('rss-parser');
const cron = require('node-cron');
const { researchTopic } = require('./src/researcher');
const { generateArticle, generateSocialContent, parseArticle, parseSocial } = require('./src/writer');

const parser = new RSSParser();

const OUTPUT_DIR = path.join(__dirname, '..', 'generated_reports');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const FEEDS = [
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.npr.org/1001/rss.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
];

const PROCESSED_DB = path.join(__dirname, 'processed_urls.json');
function loadProcessed() {
  try { return new Set(JSON.parse(fs.readFileSync(PROCESSED_DB, 'utf8'))); }
  catch { return new Set(); }
}
function saveProcessed(set) {
  fs.writeFileSync(PROCESSED_DB, JSON.stringify([...set]));
}

async function fetchTopStories() {
  const all = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      const items = feed.items.slice(0, 3).map(item => ({
        title: item.title,
        link: item.link,
        summary: item.contentSnippet || item.summary || '',
        source: feed.title,
        pubDate: item.pubDate,
      }));
      all.push(...items);
    } catch (err) {
      console.warn(`Error fetching ${url}: ${err.message}`);
    }
  }
  return all.slice(0, 5);
}

function saveOutput(parsed, social, item, research) {
  const slug = (parsed.headline || item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${slug}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);

  const output = {
    generatedAt: new Date().toISOString(),
    source: item.source,
    sourceUrl: item.link,
    article: parsed,
    social: parseSocial(social),
    researchSources: research.sources,
  };

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
  console.log(`Saved: ${filename}`);
  return filepath;
}

async function runPipeline() {
  console.log(`\n[${new Date().toISOString()}] Starting ClearLens pipeline...`);

  const processed = loadProcessed();
  const stories = await fetchTopStories();
  const newStories = stories.filter(s => s.link && !processed.has(s.link));

  console.log(`Found ${stories.length} stories, ${newStories.length} new.`);

  if (newStories.length === 0) {
    console.log('No new stories to process.');
    return;
  }

  for (const item of newStories) {
    console.log(`\nProcessing: ${item.title}`);
    try {
      console.log('  Fetching source content...');
      const research = await researchTopic(item);

      if (!research.primaryText || research.primaryText.length < 100) {
        console.warn('  Insufficient content. Skipping.');
        continue;
      }

      console.log('  Generating article with Groq...');
      const rawArticle = await generateArticle(item, research);
      const parsed = parseArticle(rawArticle);

      if (!parsed.headline || !parsed.body) {
        console.warn('  Article incomplete. Skipping.');
        continue;
      }

      console.log('  Generating social content...');
      const social = await generateSocialContent(rawArticle, parsed.headline);

      saveOutput(parsed, social, item, research);
      processed.add(item.link);
      saveProcessed(processed);

      console.log(`  Done: ${parsed.headline}`);
      await new Promise(r => setTimeout(r, 8000));

    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log('\nPipeline complete.');
}

runPipeline();
cron.schedule('0 */6 * * *', runPipeline);
console.log('ClearLens agent running. Executes every 6 hours.');
