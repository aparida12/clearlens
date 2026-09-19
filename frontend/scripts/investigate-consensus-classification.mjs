import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const INPUT_FILE = path.resolve(process.cwd(), "research-source-recovery-dry-run.json");
const OUTPUT_FILE = path.resolve(process.cwd(), "consensus-classification-investigation.json");
const IDS = [3, 5, 6, 17, 19];
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

const SYSTEM_PROMPT = "You are a research aggregator. Below is a list of REAL sources that were actually fetched for the topic, each with its title, outlet, summary, and URL. For each real source, determine its stance toward the affirmative reading of the question: agree, disagree, or neutral, based only on what the actual source says. Do NOT invent or add sources. Return ONLY valid JSON, no other text, in this exact format: {sources:[{name,type,stance,bias,reason}],summary,confidence,consensus_pct}. Include one entry for each supplied source.";
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function extractSources(record) {
  return [
    ...(record.research?.findings?.corroborating_studies || []),
    ...(record.research?.findings?.related_news || []),
    ...(record.research?.findings?.complementary_research || []),
  ].filter((source) => source?.url && source?.title).slice(0, 6);
}
async function main() {
  loadEnvFile();
  ({ callAI, CHEAP_MODEL } = await import("../lib/groq.js"));
  const input = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
  const results = [];
  for (const id of IDS) {
    const record = input.records.find((item) => item.id === id);
    const sources = extractSources(record);
    const sourceText = sources.map((source, index) => `${index + 1}. OUTLET: ${source.source || "Unknown"} | TITLE: ${clean(source.title)} | SUMMARY: ${clean(source.summary) || "No summary provided"} | URL: ${source.url}`).join("\n");
    const userPrompt = `Topic: ${record.title}. Question: What is the consensus on: ${record.title}?\n\n${sourceText}`;
    let raw = null;
    let error = null;
    try {
      raw = await callAI(SYSTEM_PROMPT, userPrompt, { model: CHEAP_MODEL, maxTokens: 1400, temperature: 0.2 });
    } catch (caught) {
      error = String(caught?.message || caught);
    }
    results.push({ id, title: record.title, systemPrompt: SYSTEM_PROMPT, userPrompt, sources, rawResponse: raw, error });
  }
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify({ mode: "INVESTIGATION ONLY - NO WRITES", records: results }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: OUTPUT_FILE, records: results.length }, null, 2));
}
main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
