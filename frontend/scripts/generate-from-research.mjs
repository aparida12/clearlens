import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = path.resolve(process.cwd(), "..");
const DB_FILE = path.join(ROOT, "processed_items.db");
const ARTICLES_FILE = path.resolve(process.cwd(), "data/articles.json");
const REPORT_FILE = path.resolve(process.cwd(), "research-article-generation-dry-run.json");
const APPLY = process.argv.includes("--apply");
const SAMPLE_SIZE = Number(process.env.RESEARCH_DRY_RUN_SAMPLES || 3);
const VALID_SECTIONS = new Set(["Health", "Politics", "Science", "Economy", "Technology", "Environment", "Law", "World", "Sports", "Entertainment"]);
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
let callAI;
let ARTICLE_MODEL;
let fetchArticleImage;
let generateSlug;
let parseArticle;

function loadEnvFile() {
  for (const file of [path.resolve(process.cwd(), ".env.local"), path.join(ROOT, ".env")]) {
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
      break;
    } catch {}
  }
}

const SYSTEM_PROMPT = `You are a staff writer producing a finished ClearLens public-health news article from an existing research brief.
Use only facts, named sources, dates, organizations, places, numbers, and uncertainty stated in the supplied research brief. Do not browse, search, add sources, or invent consensus.
Write eight substantial paragraphs of hard news prose. No markdown, bullet lists, or section headings in the body.
Return exactly this format:
SECTION: [one of Health, Politics, Science, Economy, Technology, Environment, Law, World, Sports, Entertainment]
HEADLINE: [title-case headline under 12 words]
SUBHEADLINE: [one sentence, maximum 20 words]
BYLINE: ClearLens Staff
DATE: [today's full date]
LOCATION: [CITY -]

[body paragraphs]

PULL_QUOTE: [one sentence copied from the body]
SOURCES:
- [source name and citation exactly supported by the research brief]
- [source name and citation exactly supported by the research brief]
- [source name and citation exactly supported by the research brief]
META: {"bias_score":0,"tags":["specific","tags"],"word_count":0,"confidence":"high"}`;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return clean(value).split(" ").map((word, index) => {
    const leading = word.match(/^[^A-Za-z0-9]*/)?.[0] || "";
    const trailing = word.match(/[^A-Za-z0-9]*$/)?.[0] || "";
    const core = word.slice(leading.length, word.length - trailing.length || word.length);
    if (!core) return word;
    const lower = core.toLowerCase();
    const formatted = /^[A-Z0-9.]+$/.test(core) && core.length <= 5
      ? core
      : index > 0 && SMALL_WORDS.has(lower)
        ? lower
        : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    return `${leading}${formatted}${trailing}`;
  }).join(" ");
}

function inferSection(text) {
  const value = clean(text).toLowerCase();
  const matches = [
    ["Sports", /\b(nfl|football|touchdown|quarterback|nba|soccer|world cup|tennis|olympic)\b/],
    ["Entertainment", /\b(movie|film|cinema|box office|actor|actress|television|music|album)\b/],
    ["Law", /\b(court|judge|lawsuit|ruling|legal|law|sentenc\w*|appeal|prosecutor)\b/],
    ["Environment", /\b(climate|air quality|wildfire|heat wave|environment|flood|drought|emission)\b/],
    ["Politics", /\b(election|parliament|policy|regulation|minister|government|president|senate|congress)\b/],
    ["Economy", /\b(market|inflation|economy|cost|budget|trade|tariff|bank|finance)\b/],
    ["Technology", /\b(ai|technology|tech|chip|software|cyber|algorithm|platform|robot)\b/],
    ["Science", /\b(study|research|experiment|laboratory|lab|physics|space|astronomy|biology|trial)\b/],
    ["Health", /\b(vaccine|hospital|disease|health|medical|cdc|measles|outbreak|patient|public health)\b/],
    ["World", /\b(war|military|missile|iran|ukraine|ceasefire|diplomatic|russia|germany|nepal)\b/],
  ];
  const found = matches.filter(([, pattern]) => pattern.test(value)).map(([section]) => section);
  return found.length === 1 ? found[0] : null;
}

function extractReferenceCount(content) {
  const match = clean(content).match(/(?:found|identified)\s+(\d+)\s+(?:peer-reviewed|corroborating) references/i);
  return match ? Number(match[1]) : 0;
}

function extractExistingConsensus(content) {
  const match = String(content || "").match(/(?:^|\n)\s*(\{\s*"?consensus(?:_pct|Pct)?"?[\s\S]*?\})\s*$/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return Number.isFinite(Number(parsed.consensus_pct)) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeTags(tags, section) {
  const values = Array.isArray(tags) ? tags.map(clean).filter(Boolean) : [];
  return [section, ...values.filter((tag) => !VALID_SECTIONS.has(tag))]
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index)
    .slice(0, 6);
}

function readResearchRows() {
  const db = new Database(DB_FILE, { readonly: true });
  const rows = db.prepare("SELECT id, title, source, article_date, url, content, status, attachment_name FROM uploaded_articles ORDER BY id").all();
  db.close();
  return rows.map((row) => ({
    ...row,
    referenceCount: extractReferenceCount(row.content),
    consensus: extractExistingConsensus(row.content),
  }));
}

async function generateArticle(row) {
  if (row.referenceCount < 3) {
    return { id: row.id, title: row.title, status: "manual_review", reasons: [`Only ${row.referenceCount} corroborating references found; at least 3 are required.`] };
  }

  const sourceLine = row.url ? `Original source URL: ${row.url}` : "Original source URL: unavailable";
  const prompt = `${sourceLine}\nOriginal title: ${row.title}\nOriginal source: ${row.source || "Unknown"}\nOriginal date: ${row.article_date || "Unknown"}\n\nRESEARCH BRIEF:\n${row.content}`;
  let raw;
  try {
    raw = await callAI(SYSTEM_PROMPT, prompt, { model: ARTICLE_MODEL, maxTokens: 2600, temperature: 0.35 });
  } catch (error) {
    return { id: row.id, title: row.title, status: "failed", reasons: [String(error?.message || error)] };
  }

  const parsed = parseArticle(raw);
  if (!parsed) {
    return { id: row.id, title: row.title, status: "failed", reasons: ["Groq output did not match the current article format."] };
  }

  const section = inferSection(`${row.title} ${parsed.headline} ${parsed.subheadline}`) || parsed.section;
  const reasons = [];
  if (!VALID_SECTIONS.has(section)) reasons.push(`Ambiguous or invalid category: ${section || "missing"}.`);
  if (!row.consensus) reasons.push("No structured consensus score exists in the local research record; consensus was not rerun.");
  const image = process.env.UNSPLASH_ACCESS_KEY
    ? await fetchArticleImage(row.title, section)
    : null;
  if (!image) reasons.push("No existing image and UNSPLASH_ACCESS_KEY is unavailable; image requires manual completion.");

  const article = {
    id: null,
    slug: generateSlug(titleCase(parsed.headline)),
    topic: row.title,
    section,
    headline: titleCase(parsed.headline),
    subheadline: parsed.subheadline,
    byline: parsed.byline || "ClearLens Staff",
    date: parsed.date,
    location: parsed.location,
    body: parsed.body,
    pullQuote: parsed.pullQuote,
    sources: parsed.sources,
    meta: { ...parsed.meta, tags: normalizeTags(parsed.meta.tags, section), word_count: parsed.body.split(/\s+/).filter(Boolean).length },
    image,
    status: reasons.length ? "pending_review" : "published",
    verification: row.referenceCount >= 3 ? "verified" : "low_coverage",
    qualityScore: null,
    qualityIssues: reasons,
    agentRun: "research-to-article",
    generatedAt: new Date().toISOString(),
    createdAt: null,
    consensus: row.consensus,
  };

  return { id: row.id, title: row.title, status: reasons.length ? "manual_review" : "ready", reasons, article };
}

async function main() {
  loadEnvFile();
  ({ callAI, ARTICLE_MODEL } = await import("../lib/groq.js"));
  ({ fetchArticleImage } = await import("../lib/fetchImage.js"));
  ({ generateSlug } = await import("../lib/generateSlug.js"));
  ({ parseArticle } = await import("../lib/parseArticle.js"));
  const rows = readResearchRows();
  const results = [];
  for (const row of rows) results.push(await generateArticle(row));

  const report = {
    mode: APPLY ? "APPLY - LOCAL ARTICLE STORE" : "DRY RUN - NO ARTICLE WRITES",
    input: { table: "uploaded_articles", recordCount: rows.length, minimumCorroboratingReferences: 3 },
    pipeline: { research: "reused", consensus: "reused when present; never rerun", writing: "Groq only", image: "existing or Unsplash fetch" },
    summary: {
      researchRecords: rows.length,
      eligibleForWriting: rows.filter((row) => row.referenceCount >= 3).length,
      insufficientResearch: rows.filter((row) => row.referenceCount < 3).length,
      existingStructuredConsensus: rows.filter((row) => row.consensus).length,
      ready: results.filter((result) => result.status === "ready").length,
      manualReview: results.filter((result) => result.status === "manual_review").length,
      failed: results.filter((result) => result.status === "failed").length,
    },
    samples: results.filter((result) => result.article).slice(0, SAMPLE_SIZE).map((result) => ({
      id: result.id,
      headline: result.article.headline,
      description: result.article.subheadline,
      bodyPreview: result.article.body.slice(0, 700),
      category: result.article.section,
      consensus: result.article.consensus,
      review: result.reasons,
    })),
    records: results.map(({ article, ...result }) => ({
      ...result,
      generated: Boolean(article),
      headline: article?.headline || null,
      category: article?.section || null,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!APPLY) return;
  const ready = results.filter((result) => result.status === "ready").map((result) => result.article);
  if (!ready.length) return;
  const existing = JSON.parse(await fs.readFile(ARTICLES_FILE, "utf8"));
  const existingSlugs = new Set(existing.map((article) => article?.slug));
  const additions = ready.filter((article) => !existingSlugs.has(article.slug));
  await fs.writeFile(ARTICLES_FILE, `${JSON.stringify([...existing, ...additions], null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ written: additions.length, skippedExisting: ready.length - additions.length }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
