import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { buildAffirmativeClaim, isRelevantConsensusSource } from "../lib/consensusUtils.js";

const ROOT = path.resolve(process.cwd(), "..");
const INPUT_FILE = path.resolve(process.cwd(), "research-source-recovery-dry-run.json");
const OUTPUT_FILE = path.resolve(process.cwd(), "research-consensus-recovery-dry-run.json");
const MIN_SOURCES = 3;
const MAX_ATTEMPTS = 3;
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

const SYSTEM_PROMPT = "You are a research aggregator. You will receive a specific affirmative factual claim and a list of REAL relevant sources. Classify each source only by what its supplied title and clean summary support about that exact claim. Use agree when the source supports the claim, disagree when it contradicts the claim, and neutral only when the source is relevant but does not establish either direction. Do not classify irrelevant sources; they have already been removed. Do NOT invent or add sources. Return ONLY valid JSON, no other text, in this exact format: {sources:[{name,type,stance,bias,reason}],summary,confidence}. Include exactly one entry for each supplied source.";

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function extractJson(text) {
  const value = String(text || "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(value.slice(start, end + 1)); } catch { return null; }
}
function normalize(payload, sources) {
  const rawItems = Array.isArray(payload?.sources) ? payload.sources : [];
  const classified = rawItems.slice(0, sources.length).map((item, index) => ({
    name: clean(item?.name || sources[index]?.source || "Unknown"),
    type: ["journal", "government", "news", "academic", "thinktank", "other"].includes(item?.type) ? item.type : "other",
    stance: ["agree", "disagree", "neutral"].includes(item?.stance) ? item.stance : "neutral",
    bias: ["left", "center", "right"].includes(item?.bias) ? item.bias : "center",
    reason: clean(item?.reason),
  })).filter((item) => item.name && item.reason);

  const summary = clean(payload?.summary);
  const DROP_RATIONALE = /(omitted?|unrelated|irrelevant|excluded?|removed?\b|does not (support|relate|apply|address)|not (relevant|related)|dropped?\b|only .* (support|relevant))/i;
  const hasDropRationale = DROP_RATIONALE.test(summary || "");
  const droppedSources = sources.slice(classified.length).map((source) => ({
    name: clean(source?.source || "Unknown"),
    title: clean(source?.title || source?.summary || ""),
    url: clean(source?.url || ""),
    reason: hasDropRationale ? clean(summary) : "",
  }));

  if (classified.length < MIN_SOURCES || !summary) return null;
  const counts = {
    agree: classified.filter((item) => item.stance === "agree").length,
    neutral: classified.filter((item) => item.stance === "neutral").length,
    disagree: classified.filter((item) => item.stance === "disagree").length,
  };
  const needsManualReview = droppedSources.some((source) => !source.reason);
  return {
    sources: classified,
    summary,
    confidence: ["high", "medium", "low"].includes(payload.confidence) ? payload.confidence : "low",
    consensus_pct: Math.round((counts.agree / classified.length) * 100),
    counts,
    verified: true,
    droppedSources,
    needsManualReview,
  };
}
async function score(record) {
  const claim = buildAffirmativeClaim(record.title);
  const allSources = [
    ...(record.research?.findings?.corroborating_studies || []),
    ...(record.research?.findings?.related_news || []),
    ...(record.research?.findings?.complementary_research || []),
  ].filter((source) => source?.url && source?.title && String(source.summary || "").trim())
    .filter((source) => isRelevantConsensusSource(source, claim))
    .slice(0, 6);
  if (allSources.length < MIN_SOURCES) return { ...record, status: "hold", consensus: null, reason: `Only ${allSources.length} usable sources after recovery.` };
  const sourceText = allSources.map((source, index) => `${index + 1}. OUTLET: ${source.source || "Unknown"} | TITLE: ${clean(source.title)} | SUMMARY: ${clean(source.summary) || "No summary provided"} | URL: ${source.url}`).join("\n");
  let lastResult = null;
  let lastDrops = null;
  let attempts = 0;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastDrops = null;
    try {
      const raw = await callAI(SYSTEM_PROMPT, `Topic: ${record.title}\nAFFIRMATIVE CLAIM TO TEST: ${claim}\n\n${sourceText}`, { model: CHEAP_MODEL, maxTokens: 1400, temperature: 0 });
      const consensus = normalize(extractJson(raw), allSources);
      lastResult = consensus;
      if (consensus) break;
      lastDrops = describeDrops(raw, allSources);
    } catch (error) {
      lastError = String(error?.message || error);
      if (lastError.includes("rate_limit_exceeded") || /Rate limit reached/.test(lastError)) {
        const retryMatch = lastError.match(/try again in (\d+)m(\d+(?:\.\d+)?)s/);
        if (retryMatch && attempt < MAX_ATTEMPTS) {
          const waitMs = Math.round((parseInt(retryMatch[1], 10) * 60 + parseFloat(retryMatch[2])) * 1000);
          const cappedWait = Math.min(waitMs, 20 * 60 * 1000);
          console.log(`   record ${record.id}: rate-limited; waiting ${Math.round(cappedWait / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`);
          await new Promise((resolve) => setTimeout(resolve, cappedWait));
          continue;
        }
        break;
      }
      continue;
    }
  }
  if (!lastResult) {
    return {
      ...record,
      status: "failed",
      scoredSourceCount: allSources.length,
      attempts,
      consensus: null,
      droppedSources: lastDrops?.droppedSources || [],
      reason: lastError || (lastDrops ? `Model returned ${lastDrops.returned} of ${allSources.length} sources (below minimum of ${MIN_SOURCES}) across ${attempts} attempt(s). Dropped source(s) logged below.` : "Consensus output was incomplete or invalid."),
    };
  }
  const consensus = lastResult;
  if (consensus.needsManualReview) {
    const base = { ...record, claim, scoredSourceCount: allSources.length, attempts };
    delete consensus.needsManualReview;
    return {
      ...base,
      status: "manual_review",
      consensus: null,
      droppedSources: consensus.droppedSources,
      reason: `${consensus.droppedSources.length} source(s) omitted by model (see droppedSources for details).`,
    };
  }
  delete consensus.needsManualReview;
  return { ...record, status: "scored", claim, scoredSourceCount: allSources.length, attempts, consensus, reason: null, droppedSources: consensus.droppedSources };
}
async function main() {
  loadEnvFile();
  ({ callAI, CHEAP_MODEL } = await import("../lib/groq.js"));

  const args = process.argv.slice(2);
  const targetsArg = args.find((arg) => arg.startsWith("--targets="));
  const compareArg = args.find((arg) => arg.startsWith("--compare="));
  const targets = targetsArg ? new Set(targetsArg.split("=")[1].split(",").map((value) => Number(value.trim())).filter(Number.isFinite)) : null;
  const compareIds = compareArg ? new Set(compareArg.split("=")[1].split(",").map((value) => Number(value.trim())).filter(Number.isFinite)) : new Set();

  const input = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
  const previous = JSON.parse(await fs.readFile(OUTPUT_FILE, "utf8"));
  const previousById = new Map((previous.records || []).map((record) => [record.id, record]));
  const records = [];
  for (const record of input.records || []) {
    if (targets && !targets.has(record.id)) continue;
    console.log(`Scoring record ${record.id}: ${record.title}`);
    const skipped = previousById.get(record.id);
    let result = await score(record);

    if (compareIds.has(record.id)) {
      const prior = skipped?.priorConsensus || skipped?.consensus;
      if (prior) {
        const agreement = compareConsensus(prior, result.consensus);
        if (result.status === "scored" && !agreement.agree) {
          result = {
            ...result,
            status: "hold",
            consensus: null,
            priorConsensus: prior,
            reason: `Scored twice but runs meaningfully disagreed on stance (first: ${agreement.first}, second: ${agreement.second}). Held pending review.`,
            disagreement: agreement.detail,
          };
        } else if (result.status === "manual_review") {
          result = {
            ...result,
            priorConsensus: prior,
            reason: `Second run dropped ${result.droppedSources?.length || 0} source(s) (prior run scored all ${prior.sources.length}); prior consensus preserved above. ${result.reason}`,
          };
        } else if (agreement.agree) {
          result = { ...result, notedAgreement: `Second run matches prior: ${agreement.second}` };
        } else if (!agreement.agree) {
          result = { ...result, reason: `${result.reason || "No consensus on this run."} Prior (from recorded run): ${agreement.first}.` };
        }
      } else {
        result = { ...result, note: "No prior consensus to compare; this is the comparison run." };
      }
    }

    if (result.status === "failed" && skipped?.status === "scored") {
      result = {
        ...skipped,
        revalidationFailed: true,
        revalidationReason: result.reason,
      };
    }

    if (result.status === "failed" && compareIds.has(record.id) && (skipped?.priorConsensus || skipped?.consensus)) {
      result = {
        ...result,
        priorConsensus: skipped.priorConsensus || skipped.consensus,
        reason: `${result.reason || ""} Prior was seeded as priorConsensus and preserved for comparison.`,
      };
    }

    records.push(result);
  }

  if (targets) {
    const finalRecords = (previous.records || []).map((record) => records.find((r) => r.id === record.id) || record);
    const report = {
      mode: "CONSENSUS RECOVERY DRY RUN - NO ARTICLE OR DATABASE WRITES",
      module: "frontend/app/api/poll/route.js prompt and normalization contract",
      minimumSources: MIN_SOURCES,
      summary: {
        requested: finalRecords.length,
        scored: finalRecords.filter((record) => record.status === "scored").length,
        held: finalRecords.filter((record) => record.status === "hold").length,
        manual_review: finalRecords.filter((record) => record.status === "manual_review").length,
        failed: finalRecords.filter((record) => record.status === "failed").length,
      },
      records: finalRecords,
    };
    await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output: OUTPUT_FILE, ...report.summary }, null, 2));
    return;
  }

  const report = {
    mode: "CONSENSUS RECOVERY DRY RUN - NO ARTICLE OR DATABASE WRITES",
    module: "frontend/app/api/poll/route.js prompt and normalization contract",
    minimumSources: MIN_SOURCES,
    summary: {
      requested: records.length,
      scored: records.filter((record) => record.status === "scored").length,
      held: records.filter((record) => record.status === "hold").length,
      manual_review: records.filter((record) => record.status === "manual_review").length,
      failed: records.filter((record) => record.status === "failed").length,
    },
    records,
  };
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: OUTPUT_FILE, ...report.summary }, null, 2));
}

function describeDrops(raw, allSources) {
  const payload = extractJson(raw);
  const returned = Array.isArray(payload?.sources) ? payload.sources.length : 0;
  if (returned >= allSources.length) return null;
  const summary = clean(payload?.summary);
  const DROP_RATIONALE = /(omitted?|unrelated|irrelevant|excluded?|removed?\b|does not (support|relate|apply|address)|not (relevant|related)|dropped?\b|only .* (support|relevant))/i;
  const hasDropRationale = DROP_RATIONALE.test(summary || "");
  const droppedSources = allSources.slice(returned).map((source) => ({
    name: clean(source?.source || "Unknown"),
    title: clean(source?.title || source?.summary || ""),
    url: clean(source?.url || ""),
    reason: hasDropRationale ? clean(summary) : "",
  }));
  return { returned, droppedSources };
}

function compareConsensus(prior, current) {
  const first = prior?.sources?.map((source) => source.stance) || [];
  const second = current?.sources?.map((source) => source.stance) || [];
  const agree = first.length === second.length && first.every((stance, i) => stance === second[i]);
  return {
    agree,
    first,
    second,
    detail: { firstCounts: prior?.counts || null, secondCounts: current?.counts || null },
  };
}
main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
