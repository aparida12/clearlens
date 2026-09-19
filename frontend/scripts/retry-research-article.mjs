import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = path.resolve(process.cwd(), "..");
let callAI;
let ARTICLE_MODEL;
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

async function main() {
  loadEnvFile();
  ({ callAI, ARTICLE_MODEL } = await import("../lib/groq.js"));
  ({ parseArticle } = await import("../lib/parseArticle.js"));
  const db = new Database(path.join(ROOT, "processed_items.db"), { readonly: true });
  const row = db.prepare("SELECT id, title, source, article_date, url, content FROM uploaded_articles WHERE id = 7").get();
  db.close();
  const prompt = `Original source URL: ${row.url}\nOriginal title: ${row.title}\nOriginal source: ${row.source}\nOriginal date: ${row.article_date}\n\nRESEARCH BRIEF:\n${row.content}`;
  const raw = await callAI(SYSTEM_PROMPT, prompt, { model: ARTICLE_MODEL, maxTokens: 2800, temperature: 0.25 });
  const parsed = parseArticle(raw);
  console.log(JSON.stringify({ id: row.id, inputTitle: row.title, parseSucceeded: Boolean(parsed), output: parsed || raw }, null, 2));
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
