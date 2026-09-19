import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

let callAI;
let CHEAP_MODEL;
let fetchArticleImage;

const VALID_SECTIONS = new Set([
  "Health", "Politics", "Science", "Economy", "Technology", "Environment", "Law", "World", "Sports", "Entertainment",
]);
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
const DRY_RUN = !process.argv.includes("--apply");
const DATA_FILE = path.resolve(process.cwd(), "data/articles.json");
const REPORTS_DIR = path.resolve(process.cwd(), "../generated_reports");

function loadEnvFile() {
  for (const file of [path.resolve(process.cwd(), ".env.local"), path.resolve(process.cwd(), ".env")]) {
    try {
      const content = requireText(file);
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
      break;
    } catch {}
  }
}

function requireText(file) {
  return readFileSync(file, "utf8");
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return clean(value).split(" ").map((word, index) => {
    const leading = word.match(/^[^A-Za-z0-9]*/)?.[0] || "";
    const trailing = word.match(/[^A-Za-z0-9]*$/)?.[0] || "";
    const core = word.slice(leading.length, word.length - trailing.length || word.length);
    if (!core) return word;
    if (/^[A-Z0-9.]+$/.test(core) && core.length <= 5) return word;
    const lower = core.toLowerCase();
    const formatted = index > 0 && SMALL_WORDS.has(lower)
      ? lower
      : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    return `${leading}${formatted}${trailing}`;
  }).join(" ");
}

const CATEGORY_PATTERNS = {
  Sports: /\b(nfl|football|touchdown|quarterback|nba|soccer|world cup|tennis|olympic)\b/,
  Entertainment: /\b(movie|film|cinema|box office|actor|actress|television|tv series|music|album)\b/,
  Law: /\b(court|judge|lawsuit|ruling|legal|law|sentenc|appeal|prosecutor)\w*/,
  Environment: /(climate|air quality|wildfire|heat wave|environment|flood|drought|emission)/,
  Politics: /(election|parliament|policy|regulation|minister|government|president|senate|congress)/,
  Economy: /(market|inflation|economy|cost|budget|trade|tariff|bank|finance)/,
  Technology: /\b(ai|technology|tech|chip|software|cyber|algorithm|platform|robot)\b/,
  Science: /(study|research|experiment|laboratory|lab|physics|space|astronomy|biology)/,
  Health: /(vaccine|hospital|disease|health|medical|cdc|measles|outbreak|patient)/,
  World: /(war|military|missile|iran|ukraine|ceasefire|diplomatic|russia|germany|nepal)/,
};

function classify(text) {
  const value = clean(text).toLowerCase();
  const matches = Object.entries(CATEGORY_PATTERNS)
    .filter(([, pattern]) => pattern.test(value))
    .map(([category]) => category);
  if (matches.length === 1) return { value: matches[0], review: null };
  return { value: null, review: matches.length ? `Ambiguous category candidates: ${matches.join(", ")}.` : "No category could be inferred from local fields." };
}

function normalizeRecord(row) {
  const article = row?.article && typeof row.article === "object" ? { ...row.article, ...row } : { ...row };
  article.slug = row.slug || article.slug || row.__filePath?.split(/[\\/]/).pop()?.replace(/\.json$/, "") || "";
  article.headline = clean(row.headline || article.headline);
  article.subheadline = clean(row.subheadline || article.subheadline);
  article.topic = clean(row.topic || article.topic || article.headline);
  article.section = clean(row.section || article.section);
  article.sources = Array.isArray(row.sources || article.sources)
    ? (row.sources || article.sources)
    : Array.isArray(row.researchSources)
      ? row.researchSources.map((source) => source?.url || source?.title || "").filter(Boolean)
      : [];
  article.meta = row.meta && typeof row.meta === "object" ? row.meta : (article.meta && typeof article.meta === "object" ? article.meta : {});
  article.image = row.image || article.image || null;
  return article;
}

function citationSources(article) {
  return article.sources.map((citation, index) => ({
    name: `Stored source ${index + 1}`,
    title: clean(citation).slice(0, 240),
    description: clean(citation),
    url: clean(citation).match(/https?:\/\/\S+/)?.[0] || `citation:${index + 1}`,
    source: clean(citation).split(/[.:]/)[0] || "Stored citation",
  })).filter((source) => source.description);
}

async function scoreConsensus(article) {
  const sources = citationSources(article).slice(0, 6);
  if (sources.length < 3) return { value: null, reason: `Only ${sources.length} stored sources; at least 3 required.` };
  const prompt = `Topic: ${article.topic}\nQuestion: What is the consensus on: ${article.headline}?\n\n${sources.map((source, index) => `${index + 1}. ${source.source}: ${source.title}\n${source.description}`).join("\n")}`;
  try {
    const raw = await callAI(
      "Classify only the supplied real sources as agree, neutral, or disagree about the question. Return JSON only: {sources:[{name,stance,reason}],summary,confidence}. Include one source entry per input source.",
      prompt,
      { model: CHEAP_MODEL, maxTokens: 900, temperature: 0.1 },
    );
    const text = String(raw || "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
    const classified = Array.isArray(parsed?.sources) ? parsed.sources.slice(0, sources.length).map((source, index) => ({
      outlet: clean(source?.name || sources[index].source),
      stance: ["agree", "neutral", "disagree"].includes(source?.stance) ? source.stance : "neutral",
      reason: clean(source?.reason || "No specific assessment provided."),
    })) : [];
    if (classified.length < 3 || !clean(parsed?.summary)) return { value: null, reason: "Consensus model returned incomplete output." };
    const counts = {
      agree: classified.filter((source) => source.stance === "agree").length,
      neutral: classified.filter((source) => source.stance === "neutral").length,
      disagree: classified.filter((source) => source.stance === "disagree").length,
    };
    return {
      value: { sources: classified, summary: clean(parsed.summary), confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low", consensus_pct: Math.round((counts.agree / classified.length) * 100), counts, verified: true },
      reason: "Generated from stored citations.",
    };
  } catch (error) {
    return { value: null, reason: `Consensus failed: ${error?.message || String(error)}` };
  }
}

async function readRecords() {
  loadEnvFile();
  const collection = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const records = collection.map((row) => ({ ...row, __filePath: DATA_FILE, __collection: true }));
  let reportFiles = [];
  try { reportFiles = (await fs.readdir(REPORTS_DIR)).filter((file) => file.endsWith(".json")); } catch {}
  for (const file of reportFiles) {
    const filePath = path.join(REPORTS_DIR, file);
    try {
      const report = JSON.parse(await fs.readFile(filePath, "utf8"));
      records.push({ ...report, article: report.article || {}, __filePath: filePath, __report: true });
    } catch {}
  }
  return records;
}

async function imageIsHealthy(url) {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function proposedImage(article, imageCounts) {
  const currentUrl = clean(article.image?.url);
  if (!currentUrl) return { value: null, reason: "Image missing; re-fetch required." };
  if ((imageCounts.get(currentUrl) || 0) > 1) return { value: null, reason: "Duplicate image reference; re-fetch required." };
  if (!(await imageIsHealthy(currentUrl))) return { value: null, reason: "Image URL is broken or unreachable; re-fetch required." };
  return { value: article.image, reason: "Existing image is unique and reachable." };
}

async function auditRecord(row, index, allRows) {
  const article = normalizeRecord(row);
  const old = {
    headline: article.headline,
    section: article.section,
    tags: article.meta.tags || [],
    word_count: article.meta.word_count,
    location: article.location,
    image_url: article.image?.url || null,
    consensus: article.consensus || null,
  };
  const classification = classify(`${article.topic} ${article.headline} ${article.subheadline}`);
  const existingSection = VALID_SECTIONS.has(article.section) ? article.section : null;
  const nextSection = existingSection || classification.value;
  const changes = [];
  const nextHeadline = titleCase(article.headline);
  if (nextHeadline !== old.headline) changes.push({ field: "headline", old: old.headline, next: nextHeadline });
  if (nextSection && nextSection !== old.section) changes.push({ field: "section", old: old.section || null, next: nextSection });
  if (!nextSection) changes.push({ field: "section", old: old.section || null, next: null, review: classification.review });
  const nextTags = [nextSection, ...(Array.isArray(old.tags) ? old.tags : [])].filter(Boolean).filter((tag, position, list) => list.indexOf(tag) === position).filter((tag) => tag === nextSection || !VALID_SECTIONS.has(String(tag)));
  if (JSON.stringify(nextTags) !== JSON.stringify(old.tags)) changes.push({ field: "meta.tags", old: old.tags, next: nextTags });
  const imageCounts = new Map();
  for (const item of allRows) {
    const url = clean(normalizeRecord(item).image?.url);
    if (url) imageCounts.set(url, (imageCounts.get(url) || 0) + 1);
  }
  const imagePlan = await proposedImage(article, imageCounts);
  let replacementImage = null;
  if (!imagePlan.value) {
    const fetched = await fetchArticleImage(article.topic || article.headline, nextSection || article.section);
    if (fetched) {
      replacementImage = fetched;
      changes.push({ field: "image", old: old.image_url, next: fetched.url });
    }
    else changes.push({ field: "image", old: old.image_url, next: null, review: "Image provider returned no replacement." });
  }
  let consensus = article.consensus;
  if (!consensus || !Number.isFinite(Number(consensus.consensus_pct))) {
    const scored = await scoreConsensus(article);
    consensus = scored.value;
    changes.push({ field: "consensus", old: null, next: consensus ? { consensus_pct: consensus.consensus_pct, counts: consensus.counts } : null, review: consensus ? null : scored.reason });
  }
  return { row, article, index, old, changes, nextSection, nextTags, consensus, imagePlan, replacementImage };
}

async function writeRecord(result) {
  const article = { ...result.article, headline: result.changes.find((change) => change.field === "headline")?.next || result.article.headline, section: result.nextSection || result.article.section, meta: { ...result.article.meta, tags: result.nextTags }, consensus: result.consensus };
  const imageChange = result.changes.find((change) => change.field === "image" && change.next);
  if (imageChange) article.image = result.replacementImage || article.image;
  if (result.row.__filePath) {
    if (result.row.__collection) {
      const collection = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
      const index = collection.findIndex((item) => item.slug === result.article.slug);
      if (index >= 0) collection[index] = article;
      await fs.writeFile(DATA_FILE, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
      return;
    }
    const report = JSON.parse(await fs.readFile(result.row.__filePath, "utf8"));
    report.article = { ...report.article, ...article };
    report.consensus = article.consensus;
    await fs.writeFile(result.row.__filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return;
  }
}

async function main() {
  loadEnvFile();
  ({ callAI, CHEAP_MODEL } = await import("../lib/groq.js"));
  ({ fetchArticleImage } = await import("../lib/fetchImage.js"));
  const rows = await readRecords();
  const results = [];
  for (let index = 0; index < rows.length; index += 1) results.push(await auditRecord(rows[index], index, rows));
  const report = {
    mode: DRY_RUN ? "DRY RUN - NO WRITES" : "APPLY",
    recordCount: results.length,
    schema: { required: ["slug", "headline", "subheadline", "body", "sources", "meta", "image", "consensus"], untouched: ["body", "sources", "date", "publishedAt"] },
    records: results.map((result) => ({ index: result.index + 1, slug: result.article.slug, title: result.article.headline, changes: result.changes })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (DRY_RUN) await fs.writeFile(path.resolve(process.cwd(), "migration-dry-run-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (DRY_RUN) return;
  let updated = 0;
  const manualReview = [];
  for (const result of results) {
    const reviewChanges = result.changes.filter((change) => change.review);
    if (reviewChanges.length) {
      manualReview.push({ slug: result.article.slug, fields: reviewChanges.map((change) => change.field), reasons: reviewChanges.map((change) => change.review) });
      continue;
    }
    try { await writeRecord(result); updated += 1; } catch (error) { manualReview.push({ slug: result.article.slug, reason: error?.message || String(error) }); }
  }
  console.log(JSON.stringify({ updated, total: results.length, manualReview }, null, 2));
}

main().catch((error) => { console.error(error?.message || String(error)); process.exitCode = 1; });
