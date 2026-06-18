require('dotenv').config();
const fs = require('fs');
const path = require('path');
const RSSParser = require('rss-parser');
const cron = require('node-cron');
const { researchTopic } = require('./src/researcher');
const { generateArticle, generateSocialContent, scoreSources, parseArticle, parseSocial } = require('./src/writer');
const { postTweet } = require('./src/twitter');

const parser = new RSSParser();

// Set to true once you've tested and trust the pipeline.
// While false, tweets are generated and saved but NOT posted.
const AUTO_POST_TWITTER = process.env.AUTO_POST_TWITTER === 'true';

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
  return all.slice(0, 4);
}

function saveOutput(parsed, social, consensus, item, research, tweetStatus) {
  const slug = (parsed.headline || item.title)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${slug}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);

  const stances = (consensus.sources || []).map(s => s.stance);
  const supports = stances.filter(s => s === 'supports').length;
  const disputes = stances.filter(s => s === 'disputes').length;
  const mixed = stances.filter(s => s === 'mixed').length;
  const neutral = stances.filter(s => s === 'neutral').length;

  const output = {
    generatedAt: new Date().toISOString(),
    source: item.source,
    sourceUrl: item.link,
    article: parsed,
    social: parseSocial(social),
    consensus: {
      centralClaim: consensus.centralClaim || '',
      summary: consensus.consensusSummary || '',
      stats: { supports, disputes, mixed, neutral, total: stances.length },
      sources: consensus.sources || [],
    },
    researchSources: research.sources.map(s => ({
      title: s.title, url: s.url, outlet: s.outlet, publishedAt: s.publishedAt,
    })),
    tweetStatus: tweetStatus,
  };

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
  console.log(`  Saved: ${filename}`);
  return filepath;
}

async function runPipeline() {
  console.log(`\n[${new Date().toISOString()}] Starting ClearLens pipeline...`);
  console.log(`Auto-post to Twitter: ${AUTO_POST_TWITTER ? 'ON' : 'OFF (dry run)'}`);

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
      console.log('  Fetching multiple sources...');
      const research = await researchTopic(item);
      console.log(`  Found ${research.sources.length} sources.`);

      // Hallucination guard: require at least 3 sources with real content
      const sourcesWithContent = research.sources.filter(
        s => (s.content || '').length > 150
      );
      if (sourcesWithContent.length < 2) {
        console.warn(`  Only ${sourcesWithContent.length} sources had real content. Skipping to avoid hallucination risk.`);
        continue;
      }

      if (research.sources.length === 0) {
        console.warn('  No sources found. Skipping.');
        continue;
      }

      console.log('  Scoring consensus...');
      const consensus = await scoreSources(research.sources, research.query);
      console.log(`  Consensus: ${JSON.stringify(consensus.sources?.map(s => s.stance))}`);

      await new Promise(r => setTimeout(r, 5000));

      console.log('  Generating article...');
      const rawArticle = await generateArticle(item, research);
      const parsed = parseArticle(rawArticle);

      if (!parsed.headline || !parsed.body) {
        console.warn('  Article incomplete. Skipping.');
        continue;
      }

      await new Promise(r => setTimeout(r, 5000));

      console.log('  Generating social content...');
      const social = await generateSocialContent(rawArticle, parsed.headline);
      const parsedSocial = parseSocial(social);

      let tweetStatus = { posted: false, reason: 'auto-post disabled' };

      if (AUTO_POST_TWITTER && parsedSocial.twitter) {
        try {
          console.log('  Posting to Twitter...');
          await postTweet(parsedSocial.twitter);
          tweetStatus = { posted: true, postedAt: new Date().toISOString() };
          console.log('  Tweet posted successfully.');
        } catch (err) {
          tweetStatus = { posted: false, reason: err.message };
          console.warn(`  Tweet failed: ${err.message}`);
        }
      }

      saveOutput(parsed, social, consensus, item, research, tweetStatus);
      processed.add(item.link);
      saveProcessed(processed);

      console.log(`  Done: ${parsed.headline}`);
      await new Promise(r => setTimeout(r, 10000));

    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log('\nPipeline complete.');
}

runPipeline();
cron.schedule('0 */6 * * *', runPipeline);
console.log('ClearLens agent running. Executes every 6 hours.');
