import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = path.resolve(process.cwd(), "..");
const DB_FILE = path.join(ROOT, "processed_items.db");
const REPORT_FILE = path.resolve(process.cwd(), "research-consensus-pass.json");
const MIN_SOURCES = 3;
let callAI;
let CHEAP_MODEL;

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

const SYSTEM_PROMPT = "You are a research aggregator. Below is a list of REAL research sources that were actually stored for the topic, each with its title, outlet, summary, and URL. For each source, determine its stance toward the affirmative reading of the question: agree, disagree, or neutral, based only on the supplied source title and summary. Do NOT invent or add sources. Return ONLY valid JSON in this exact format: {sources:[{name,type,stance,bias,reason}],summary,confidence,consensus_pct}. Use one entry for every supplied source.";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractSources(content) {
  const sources = [];
  const sourcePattern = /Source\s+\d+:\s*([\s\S]*?)\s*Link:\s*(https?:\/\/\S+)/gi;
  for (const match of String(content || "").matchAll(sourcePattern)) {
    const sourceText = clean(match[1]);
    const separator = sourceText.indexOf(" - ");
    const name = separator >= 0 ? sourceText.slice(0, separator) : "Stored source";
    const title = separator >= 0 ? sourceText.slice(separator + 3) : sourceText;
    sources.push({
      name: clean(name),
      title: clean(title),
      description: clean(title),
      url: match[2],
      source: clean(name),
    });
  }
  return sources.filter((source, index, list) => list.findIndex((item) => item.url === source.url) === index);
}

function extractJson(text) {
  const value = String(text || "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(value.slice(start, end + 1)); } catch { return null; }
}

function normalize(payload, sources) {
  const classified = Array.isArray(payload?.sources) ? payload.sources.slice(0, sources.length).map((item, index) => ({
    name: clean(item?.name || sources[index].name),
    type: ["journal", "government", "news", "academic", "thinktank", "other"].includes(item?.type) ? item.type : "academic",
    stance: ["agree", "disagree", "neutral"].includes(item?.stance) ? item.stance : "neutral",
    bias: ["left", "center", "right"].includes(item?.bias) ? item.bias : "center",
    reason: clean(item?.reason || "No source-specific reason returned."),
  })).filter((item) => item.name && item.reason) : [];
  if (classified.length < MIN_SOURCES || !clean(payload?.summary)) return null;
  const counts = {
    agree: classified.filter((item) => item.stance === "agree").length,
    neutral: classified.filter((item) => item.stance === "neutral").length,
    disagree: classified.filter((item) => item.stance === "disagree").length,
  };
  return {
    sources: classified,
    summary: clean(payload.summary),
    confidence: ["high", "medium", "low"].includes(payload.confidence) ? payload.confidence : "low",
    consensus_pct: Math.round((counts.agree / classified.length) * 100),
    counts,
    verified: true,
  };
}

async function score(row, sources) {
  const sourceText = sources.map((source, index) => `${index + 1}. OUTLET: ${source.source} | TITLE: ${source.title} | SUMMARY: ${source.description} | URL: ${source.url}`).join("\n");
  const raw = await callAI(SYSTEM_PROMPT, `Topic: ${row.title}. Question: What is the consensus on: ${row.title}?\n\n${sourceText}`, { model: CHEAP_MODEL, maxTokens: 1200, temperature: 0.2 });
  return normalize(extractJson(raw), sources);
}

async function main() {
  loadEnvFile();
  ({ callAI, CHEAP_MODEL } = await import("../lib/groq.js"));
  const db = new Database(DB_FILE, { readonly: true });
  const rows = db.prepare("SELECT id, title, content FROM uploaded_articles ORDER BY id").all();
  db.close();
  const results = [];
  for (const row of rows) {
    const sources = extractSources(row.content);
    if (sources.length < MIN_SOURCES) {
      results.push({ id: row.id, title: row.title, status: "hold", sourceCount: sources.length, minimum: MIN_SOURCES, reason: "Fewer than three explicit stored source records with URLs; no consensus call made." });
      continue;
    }
    try {
      const consensus = await score(row, sources);
      results.push(consensus
        ? { id: row.id, title: row.title, status: "scored", sourceCount: sources.length, consensus }
        : { id: row.id, title: row.title, status: "failed", sourceCount: sources.length, reason: "Consensus model returned incomplete or invalid JSON." });
    } catch (error) {
      results.push({ id: row.id, title: row.title, status: "failed", sourceCount: sources.length, reason: String(error?.message || error) });
    }
  }
  const report = {
    mode: "CONSENSUS PASS - NO ARTICLE WRITES",
    module: "frontend/app/api/poll/route.js prompt and normalization contract",
    minimumSources: MIN_SOURCES,
    scored: results.filter((result) => result.status === "scored").length,
    held: results.filter((result) => result.status === "hold").length,
    failed: results.filter((result) => result.status === "failed").length,
    records: results,
  };
  console.log(JSON.stringify(report, null, 2));
  await import("node:fs/promises").then((fs) => fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8"));
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
