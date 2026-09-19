import { NextResponse } from "next/server";
import { callAI, CHEAP_MODEL, capSourcesForPrompt } from "@/lib/groq";
import { buildAffirmativeClaim, isRelevantConsensusSource } from "@/lib/consensusUtils";

export const dynamic = "force-dynamic";

const MIN_SOURCES = 3;

const SYSTEM_PROMPT =
  "You are a research aggregator. You will receive a specific affirmative factual claim and a list of REAL sources that were actually fetched. Classify each source only by what its supplied title and clean summary support about that exact claim. Use agree when the source supports the claim, disagree when it contradicts the claim, and neutral only when the source is relevant but does not establish either direction. Do not classify an irrelevant source; irrelevant sources must be removed before this prompt. Do NOT invent or add sources. Return ONLY valid JSON, no other text, in this exact format:\n{\n  sources: [\n    { name: string, type: 'journal'|'government'|'news'|'academic'|'thinktank'|'other', stance: 'agree'|'disagree'|'neutral', bias: 'left'|'center'|'right', reason: string (one sentence specific to the supplied source) },\n    ... exactly one entry for each supplied source ...\n  ],\n  summary: string (2-3 sentence synthesis of the sources and claim),\n  confidence: 'high'|'medium'|'low'\n}";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function fetchNewsApiSources(topic) {
  if (!process.env.NEWS_API_KEY) return [];
  const endpoint = new URL("https://newsapi.org/v2/everything");
  endpoint.searchParams.set("q", topic);
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("sortBy", "relevance");
  endpoint.searchParams.set("pageSize", "10");
  endpoint.searchParams.set("apiKey", process.env.NEWS_API_KEY);
  try {
    const response = await fetch(endpoint.toString(), { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload?.articles)) return [];
    return payload.articles.map((item) => ({
      title: cleanText(item?.title),
      description: cleanText(item?.description),
      url: cleanText(item?.url),
      source: cleanText(item?.source?.name) || "Unknown",
      publishedAt: cleanText(item?.publishedAt),
    }));
  } catch {
    return [];
  }
}

async function fetchGNewsSources(topic) {
  if (!process.env.GNEWS_API_KEY) return [];
  const endpoint = new URL("https://gnews.io/api/v4/search");
  endpoint.searchParams.set("q", topic);
  endpoint.searchParams.set("lang", "en");
  endpoint.searchParams.set("max", "5");
  endpoint.searchParams.set("apikey", process.env.GNEWS_API_KEY);
  try {
    const response = await fetch(endpoint.toString(), { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload?.articles)) return [];
    return payload.articles.map((item) => ({
      title: cleanText(item?.title),
      description: cleanText(item?.description),
      url: cleanText(item?.url),
      source: cleanText(item?.source?.name) || "Unknown",
      publishedAt: cleanText(item?.publishedAt),
    }));
  } catch {
    return [];
  }
}

async function fetchPollSources(topic) {
  const [newsApiSources, gnewsSources] = await Promise.all([
    fetchNewsApiSources(topic),
    fetchGNewsSources(topic),
  ]);

  const seen = new Set();
  const output = [];
  for (const source of [...newsApiSources, ...gnewsSources]) {
    const url = cleanText(source?.url).toLowerCase();
    const title = cleanText(source?.title);
    if (!url || !title) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    output.push(source);
  }
  return output;
}

function formatRealSourcesForPrompt(sources) {
  return sources
    .map(
      (source, index) =>
        `${index + 1}. OUTLET: ${source.source} | TITLE: ${source.title} | SUMMARY: ${source.description || "No summary provided"} | URL: ${source.url}`,
    )
    .join("\n");
}

function normalizeCitationSources(citations) {
  if (!Array.isArray(citations)) return [];
  return citations.map((citation) => {
    const text = cleanText(citation);
    const url = text.match(/https?:\/\/\S+/)?.[0] || "";
    return {
      title: cleanText(url ? text.replace(url, "") : text).slice(0, 240),
      description: text,
      url: url || `citation:${text}`,
      source: cleanText(text.split(/[.:]/)[0]) || "Article citation",
    };
  }).filter((source) => source.title && source.description);
}

function extractJson(text) {
  const cleaned = String(text || "").trim();
  const fenced = cleaned.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : cleaned;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  const jsonText = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function normalizePoll(payload, realSources) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const sources = Array.isArray(payload.sources)
    ? payload.sources
        .filter((source) => source && typeof source === "object")
        .map((source) => ({
          name: cleanText(source.name),
          type: ["journal", "government", "news", "academic", "thinktank", "other"].includes(source.type)
            ? source.type
            : "news",
          stance: ["agree", "disagree", "neutral"].includes(source.stance) ? source.stance : "neutral",
          bias: ["left", "center", "right"].includes(source.bias) ? source.bias : "center",
          reason: cleanText(source.reason),
        }))
        .filter((source) => source.name && source.reason)
    : [];

  const summary = cleanText(payload.summary);
  const confidence = ["high", "medium", "low"].includes(payload.confidence) ? payload.confidence : "low";
  if (sources.length < MIN_SOURCES || sources.length !== realSources.length || !summary) {
    return null;
  }

  const agreeTotal = sources.filter((source) => source.stance === "agree").length;
  const neutralTotal = sources.filter((source) => source.stance === "neutral").length;
  const disagreeTotal = sources.filter((source) => source.stance === "disagree").length;
  const consensusPct = Math.round((agreeTotal / sources.length) * 100);

  return {
    sources,
    summary,
    confidence,
    consensus_pct: consensusPct,
    counts: { agree: agreeTotal, neutral: neutralTotal, disagree: disagreeTotal },
    verified: true,
    sourceCount: realSources.length,
  };
}

async function analyzeWithClaude(topic, claim, sources) {
  const promptSources = capSourcesForPrompt(sources, 6);
  const text = await callAI(
    SYSTEM_PROMPT,
    `Topic: ${topic}\nAFFIRMATIVE CLAIM TO TEST: ${claim}\n\nREAL relevant sources actually fetched about this claim:\n${formatRealSourcesForPrompt(promptSources)}`,
    {
      model: CHEAP_MODEL,
      maxTokens: 1200,
      temperature: 0,
    },
  );
  return text || null;
}

export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = String(body?.topic || "").trim();
  const question = String(body?.question || "").trim();

  if (!topic) {
    return NextResponse.json({ error: "Topic is required" }, { status: 400 });
  }

  const claim = buildAffirmativeClaim(topic, question.replace(/^What is the consensus on:\s*/i, ""));
  const fetchedSources = await fetchPollSources(topic);
  const bodySources = normalizeCitationSources(body?.sources);
  const candidateSources = fetchedSources.length >= MIN_SOURCES ? fetchedSources : bodySources;
  const realSources = candidateSources.filter((source) => isRelevantConsensusSource(source, claim));

  if (realSources.length < MIN_SOURCES) {
    return NextResponse.json({
      poll: null,
      verified: false,
      insufficientSources: true,
      sourceCount: realSources.length,
      message: `Not enough real sources (${realSources.length}/${MIN_SOURCES}) to compute a verified consensus. Consensus was not fabricated.`,
    });
  }

  try {
    const raw = (await analyzeWithClaude(topic, claim, realSources)) || null;
    const parsed = raw ? extractJson(raw) : null;
    const normalized = normalizePoll(parsed, realSources);

    if (normalized) {
      return NextResponse.json({ poll: normalized, verified: true, sourceCount: realSources.length, raw });
    }
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Failed to generate poll", details: String(error?.message || error) },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    poll: null,
    verified: false,
    insufficientSources: true,
    sourceCount: realSources.length,
    message: "Consensus could not be reliably computed from the real sources. No fabricated consensus was returned.",
  });
}
