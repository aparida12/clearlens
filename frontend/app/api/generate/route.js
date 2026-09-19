import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { parseArticle } from "@/lib/parseArticle";
import { fetchArticleImage } from "@/lib/fetchImage";
import { generateSlug } from "@/lib/generateSlug";
import { getSupabaseClient, getSupabaseConfig, saveArticleToSupabase } from "@/lib/supabaseArticles";
import { sendRequestedArticleEmail } from "@/lib/resend";
import { callAI, CHEAP_MODEL, ARTICLE_MODEL, capSourcesForPrompt } from "@/lib/groq";

export const dynamic = "force-dynamic";

const toneInstructionMap = {
  Neutral: "Keep an even, balanced framing with no rhetorical emphasis.",
  Investigative: "Prioritize accountability angles, evidence disputes, and gaps in recordkeeping.",
  Explainer: "Prioritize clarity of mechanism, timeline, and plain-language context.",
  Scientific: "Prioritize methods, study design, confidence limits, and measurement caveats.",
};

const toneTemperatureMap = {
  Neutral: 0.35,
  Investigative: 0.4,
  Explainer: 0.45,
  Scientific: 0.25,
};

const POSITIVE_SENTIMENT_TERMS = [
  "improve",
  "improves",
  "improved",
  "breakthrough",
  "approved",
  "recovery",
  "success",
  "effective",
  "benefit",
  "progress",
];

const NEGATIVE_SENTIMENT_TERMS = [
  "outbreak",
  "surge",
  "death",
  "deaths",
  "fatal",
  "risk",
  "warning",
  "recall",
  "shortage",
  "lawsuit",
  "crisis",
  "concern",
  "contamination",
];

const SYSTEM_PROMPT = `You are a staff writer at The New York Times writing hard news for an educated adult audience.

ABSOLUTE RULES (violating any rejects the article):
1. No emoji, bullet lists, headers, or markdown in the body.
2. Every sentence must contain a specific named entity: real person, organization, place, number, date, or finding.
3. Never open with generic framing like "In recent months", "As X continues", "X has entered/faces", "X is under the microscope".
4. Never use: delve, crucial, multifaceted, nuanced, stakeholders, leverage, robust, paradigm, synergistic, utilize, groundbreaking, landmark, pivotal, transformative.
5. Never write a headline like "[Topic] enters a new phase / faces new evidence / under scrutiny" (banned phrases).
6. If the topic is a single vague word, interpret it as the most newsworthy current meaning and write that specific angle.

LEDE RULE: The lede must contain a real number, named person, or named event. Not a generic overview. Example of a good lede: "Novo Nordisk reported semaglutide cut major cardiovascular events by 20 percent in a 17,604-patient trial, pushing valuation past $500 billion and prompting the FDA to expand approvals in March 2024."

STRUCTURE — eight paragraphs, no labels:
1. Lede (1-2 sentences, most important specific fact)
2. Why it matters now (specific history)
3. Primary evidence (named study, journal, year, authors)
4. Secondary evidence (complicates or supports)
5. Mechanism (causal explanation)
6. Expert (named person, title, institution, quote paraphrase)
7. Dissent (named credible objection)
8. Forward look (named trial, legislation, deadline, date)

OUTPUT FORMAT — start immediately with SECTION, no preamble:

SECTION: [Health/Science/Policy/Economy/Technology/Environment/Law/Sports/World]
HEADLINE: [Under 12 words. Named entity or number. Never generic.]
SUBHEADLINE: [One sentence, new info, max 20 words.]
BYLINE: ClearLens Staff
DATE: [today's full date]
LOCATION: [CITY -]

[Eight paragraphs plain prose]

PULL_QUOTE: [One specific sentence verbatim from body.]

SOURCES:
- [Last, First. Description. Publication. Year. URL.]
- [4-7 sources, all directly relevant to this topic]

META: {"bias_score": 0.0, "tags": ["specific","tags"], "word_count": 000, "confidence": "high"}`;

function toTitleCase(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join(" ");
}

function inferSection(topic, requestedSection) {
  const value = String(topic || "").toLowerCase();
  if (/(nfl|football|contract extension|touchdown|quarterback|nba|soccer|world cup)/.test(value)) return "Sports";
  if (/(movie|film|cinema|box office|actor|actress|television|tv series)/.test(value)) return "Entertainment";
  if (value.includes("law") || value.includes("court") || value.includes("lawsuit")) return "Law";
  if (value.includes("climate") || value.includes("air") || value.includes("water")) return "Environment";
  if (value.includes("budget") || value.includes("market") || value.includes("cost")) return "Economy";
  if (value.includes("policy") || value.includes("regulation") || value.includes("agency")) return "Policy";
  if (value.includes("ai") || value.includes("algorithm") || value.includes("platform")) return "Technology";
  if (value.includes("trial") || value.includes("study") || value.includes("lab")) return "Science";
  if (requestedSection && requestedSection !== "All") return requestedSection;
  return "Health";
}

function normalizeArticleTags(tags, section) {
  const categoryNames = new Set(["health", "politics", "policy", "science", "economy", "technology", "environment", "law", "sports", "entertainment", "world"]);
  const cleanTags = Array.isArray(tags) ? tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
  return [section, ...cleanTags.filter((tag) => !categoryNames.has(tag.toLowerCase()) && tag.toLowerCase() !== section.toLowerCase())].slice(0, 6);
}

function titleCaseHeadline(value) {
  const smallWords = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const leading = word.match(/^[^A-Za-z0-9]*/)?.[0] || "";
      const trailing = word.match(/[^A-Za-z0-9]*$/)?.[0] || "";
      const core = word.slice(leading.length, word.length - trailing.length || word.length);
      if (!core) return word;
      const lower = core.toLowerCase();
      const formatted = /^[A-Z0-9.]+$/.test(core) && core.length <= 5
        ? core
        : index > 0 && smallWords.has(lower)
        ? lower
        : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      return `${leading}${formatted}${trailing}`;
    })
    .join(" ");
}

async function generateStoredConsensus(topic, question, sources) {
  if (!Array.isArray(sources) || sources.length < 3) return null;
  try {
    const prompt = `Topic: ${topic}\nQuestion: ${question}\n\n${sources.slice(0, 6).map((source, index) => `${index + 1}. ${source.source}: ${source.title}\n${source.description || "No summary provided"}`).join("\n")}`;
    const raw = await callAI(
      "Classify only the supplied real sources as agree, neutral, or disagree about the question. Return JSON only: {sources:[{name,stance,reason}],summary,confidence}. Include one source entry per input source.",
      prompt,
      { model: CHEAP_MODEL, maxTokens: 900, temperature: 0.1 },
    );
    const start = String(raw || "").indexOf("{");
    const end = String(raw || "").lastIndexOf("}");
    const parsed = start >= 0 && end > start ? JSON.parse(String(raw).slice(start, end + 1)) : null;
    const classified = Array.isArray(parsed?.sources) ? parsed.sources.slice(0, sources.length).map((source, index) => ({
      name: String(source?.name || sources[index]?.source || "Unknown").trim(),
      stance: ["agree", "neutral", "disagree"].includes(source?.stance) ? source.stance : "neutral",
      bias: "center",
      reason: String(source?.reason || "No specific assessment provided.").trim(),
    })) : [];
    if (classified.length < 3 || !parsed?.summary) return null;
    const agree = classified.filter((source) => source.stance === "agree").length;
    return {
      sources: classified,
      summary: String(parsed.summary).trim(),
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      consensus_pct: Math.round((agree / classified.length) * 100),
      counts: {
        agree,
        neutral: classified.filter((source) => source.stance === "neutral").length,
        disagree: classified.filter((source) => source.stance === "disagree").length,
      },
      verified: true,
    };
  } catch (error) {
    console.error("[CONSENSUS GENERATION]", error?.message || String(error));
    return null;
  }
}

function formatToday() {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function inferDateline(section, topic) {
  const value = String(topic || "").toLowerCase();
  if (value.includes("who") || value.includes("un") || value.includes("global")) return "GENEVA -";
  if (section === "Policy" || value.includes("congress") || value.includes("federal")) return "WASHINGTON -";
  if (section === "Economy" || value.includes("market") || value.includes("sec")) return "LONDON -";
  if (section === "Technology" || value.includes("silicon") || value.includes("chip")) return "SAN FRANCISCO -";
  if (section === "Environment") return "BRUSSELS -";
  return "BOSTON -";
}

function formatSourceLine(source) {
  const outlet = source.source || "Unknown";
  const title = source.title || "Untitled";
  const date = source.publishedAt ? new Date(source.publishedAt).getFullYear() : new Date().getFullYear();
  const url = source.url || "";
  return `${outlet}. "${title}." ${outlet}. ${date}. ${url}`.trim();
}

function normalizeFetchedSource(source) {
  if (!source || typeof source !== "object") return null;
  const title = String(source.title || "").trim();
  const url = String(source.url || "").trim();
  if (!title || !url) return null;

  const summary = String(source.description || "").trim();
  const sentimentScore =
    typeof source.sentimentScore === "number"
      ? source.sentimentScore
      : estimateSentimentScore(`${title} ${summary}`);

  return {
    title,
    description: summary,
    url,
    source: String(source.source || "Unknown").trim() || "Unknown",
    publishedAt: String(source.publishedAt || "").trim(),
    sentimentScore,
    sentimentLabel:
      typeof source.sentimentLabel === "string" && source.sentimentLabel
        ? source.sentimentLabel
        : sentimentLabelFromScore(sentimentScore),
  };
}

function estimateSentimentScore(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized.trim()) return 0;

  const positiveHits = POSITIVE_SENTIMENT_TERMS.reduce(
    (count, term) => (normalized.includes(term) ? count + 1 : count),
    0,
  );
  const negativeHits = NEGATIVE_SENTIMENT_TERMS.reduce(
    (count, term) => (normalized.includes(term) ? count + 1 : count),
    0,
  );

  const total = positiveHits + negativeHits;
  if (!total) return 0;
  return (positiveHits - negativeHits) / total;
}

function sentimentLabelFromScore(score) {
  if (score > 0.2) return "positive";
  if (score < -0.2) return "negative";
  return "neutral";
}

function dedupeSources(sources) {
  const seen = new Set();
  const output = [];

  for (const source of sources) {
    const normalized = normalizeFetchedSource(source);
    if (!normalized) continue;
    const key = normalized.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }

  return output;
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
      title: item?.title,
      description: item?.description,
      url: item?.url,
      source: item?.source?.name,
      publishedAt: item?.publishedAt,
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
      title: item?.title,
      description: item?.description,
      url: item?.url,
      source: item?.source?.name,
      publishedAt: item?.publishedAt,
    }));
  } catch {
    return [];
  }
}

async function fetchFinnhubSources(topic) {
  if (!process.env.FINNHUB_API_KEY) return [];

  const endpoint = new URL("https://finnhub.io/api/v1/news");
  endpoint.searchParams.set("category", "general");
  endpoint.searchParams.set("token", process.env.FINNHUB_API_KEY);

  try {
    const response = await fetch(endpoint.toString(), { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload)) return [];

    const topicTokens = String(topic || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2);

    return payload
      .map((item) => ({
        title: item?.headline,
        description: item?.summary,
        url: item?.url,
        source: item?.source || "Finnhub",
        publishedAt: item?.datetime ? new Date(item.datetime * 1000).toISOString() : "",
      }))
      .filter((item) => {
        if (!topicTokens.length) return true;
        const corpus = `${item.title || ""} ${item.description || ""}`.toLowerCase();
        return topicTokens.some((token) => corpus.includes(token));
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function fetchAlphaVantageSources(topic) {
  if (!process.env.ALPHAVANTAGE_API_KEY) return [];

  const endpoint = new URL("https://www.alphavantage.co/query");
  endpoint.searchParams.set("function", "NEWS_SENTIMENT");
  endpoint.searchParams.set("keywords", topic);
  endpoint.searchParams.set("sort", "LATEST");
  endpoint.searchParams.set("limit", "10");
  endpoint.searchParams.set("apikey", process.env.ALPHAVANTAGE_API_KEY);

  try {
    const response = await fetch(endpoint.toString(), { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload?.feed)) return [];

    return payload.feed.map((item) => {
      const rawSentiment = Number(item?.overall_sentiment_score);
      const normalizedSentiment = Number.isFinite(rawSentiment)
        ? Math.max(-1, Math.min(1, rawSentiment))
        : undefined;

      const labelRaw = String(item?.overall_sentiment_label || "").toLowerCase();
      const normalizedLabel = labelRaw.includes("bull")
        ? "positive"
        : labelRaw.includes("bear")
          ? "negative"
          : labelRaw
            ? "neutral"
            : undefined;

      return {
        title: item?.title,
        description: item?.summary,
        url: item?.url,
        source: item?.source || "Alpha Vantage",
        publishedAt: item?.time_published || "",
        sentimentScore: normalizedSentiment,
        sentimentLabel: normalizedLabel,
      };
    });
  } catch {
    return [];
  }
}

async function fetchRealSources(topic) {
  const [newsApiSources, gnewsSources, finnhubSources, alphaVantageSources] = await Promise.all([
    fetchNewsApiSources(topic),
    fetchGNewsSources(topic),
    fetchFinnhubSources(topic),
    fetchAlphaVantageSources(topic),
  ]);

  return dedupeSources([...newsApiSources, ...gnewsSources, ...finnhubSources, ...alphaVantageSources]);
}

function formatRealSourcesForPrompt(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return "No real fetched sources were available from NewsAPI/GNews for this topic.";
  }

  return sources
    .map(
      (source) =>
        `SOURCE: ${source.source} | TITLE: ${source.title} | SUMMARY: ${source.description || "No summary provided"} | SENTIMENT: ${source.sentimentLabel || "neutral"} (${typeof source.sentimentScore === "number" ? source.sentimentScore.toFixed(2) : "0.00"}) | URL: ${source.url} | DATE: ${source.publishedAt || "Unknown"}`,
    )
    .join("\n");
}

function buildFallbackRawArticle(topic, tone, requestedSection, realSources = []) {
  const cleanTopic = String(topic || "").trim();
  const topicWithoutOutlet = cleanTopic.split(/\s+-\s+/)[0].trim();
  const titleTopic = topicWithoutOutlet || "Public Health";
  const section = inferSection(cleanTopic, requestedSection);
  const date = formatToday();

  const sourcePool = Array.isArray(realSources) && realSources.length > 0 ? realSources.slice(0, 6) : [];
  const references = sourcePool.map((source) => `${source.source}: ${source.title}`).join("; ");
  const dominantSource = sourcePool[0];
  const secondSource = sourcePool[1];
  const firstDate = dominantSource?.publishedAt ? new Date(dominantSource.publishedAt).toLocaleDateString("en-US") : date;

  const paragraphs = [
    `${titleTopic} is at the center of new reporting published around ${firstDate}, with outlets and institutions documenting concrete shifts in outcomes, policy, or market behavior linked to this topic. Early findings suggest the current phase is being shaped less by abstract debate and more by implementation details that can be measured in the near term.`,
    `${section} stakeholders say this matters now because decisions are being made on procurement, staffing, compliance, and risk management while the evidence base is still updating. The practical impact is immediate: organizations must set budgets and timelines before every uncertainty is resolved, which increases the value of source quality and transparent assumptions.`,
    `Recent coverage${references ? `, including ${references},` : ""} points to a pattern where short-term signals and long-term trendlines do not always move together. That mismatch has led analysts to separate what is proven today from what is plausible over the next quarter, especially when local operating conditions differ across regions and institutions.`,
    secondSource
      ? `A second thread comes from ${secondSource.source}, which describes how ${titleTopic.toLowerCase()} is being interpreted differently by regulators, operators, and researchers. Those differences are not cosmetic; they influence enforcement expectations, funding decisions, and which benchmarks are treated as success.`
      : `A second thread in the reporting is how ${titleTopic.toLowerCase()} is interpreted differently by regulators, operators, and researchers. Those differences are not cosmetic; they influence enforcement expectations, funding decisions, and which benchmarks are treated as success.`,
    `Mechanistically, the current movement appears to come from a combination of operational constraints, updated evidence, and incentives that were set before the latest findings were published. In practice, this means the same headline trend can produce very different outcomes depending on baseline capacity, governance structure, and how quickly organizations can adapt.`,
    `Expert commentary has emphasized that the next stage should prioritize auditable indicators rather than narrative certainty. Researchers and policy advisors tracking ${titleTopic.toLowerCase()} have urged institutions to publish assumptions explicitly, compare like-for-like baselines, and revise guidance when new evidence materially changes expected outcomes.`,
    `A dissenting view argues that current conclusions may still overstate confidence because many public signals are provisional and context-dependent. Critics say reported gains can disappear when measured in different populations or under tighter operational constraints, and they caution against treating early directionality as settled consensus.`,
    `What comes next is likely to be decided by scheduled disclosures, regulatory updates, and whether newer evidence confirms durability beyond early reporting windows. For decision-makers, the key question is not whether ${titleTopic.toLowerCase()} is important, but which specific claims can be defended with the strongest available evidence right now.`,
  ];

  const body = paragraphs.join("\n\n");
  const pullQuote = `The key question for ${titleTopic.toLowerCase()} is which claims remain defensible as new reporting and evidence continue to arrive.`;
  const wordCount = countWords(body);
  const headline = dominantSource?.title || titleTopic;
  const subheadline = dominantSource?.description || `Current reporting examines ${titleTopic.toLowerCase()}.`;

  const sources = sourcePool.length
    ? sourcePool.slice(0, 5).map(formatSourceLine)
    : [
        `Reuters. "Latest developments in ${titleTopic}." Reuters. ${new Date().getFullYear()}. https://www.reuters.com/`,
        `Associated Press. "Policy and operational updates tied to ${titleTopic}." AP News. ${new Date().getFullYear()}. https://apnews.com/`,
        `World Health Organization. "Situation reports related to ${titleTopic}." WHO. ${new Date().getFullYear()}. https://www.who.int/`,
        `Centers for Disease Control and Prevention. "Technical guidance relevant to ${titleTopic}." CDC. ${new Date().getFullYear()}. https://www.cdc.gov/`,
        `Nature News. "Research outlook for ${titleTopic}." Nature. ${new Date().getFullYear()}. https://www.nature.com/`,
      ];

  const tags = [
    section,
    tone,
    ...titleTopic.split(/\s+/).slice(0, 3).map((token) => token.toLowerCase()),
  ];

  return [
    `SECTION: ${section}`,
    `HEADLINE: ${headline}`,
    `SUBHEADLINE: ${subheadline}`,
    "BYLINE: ClearLens Staff",
    `DATE: ${date}`,
    `LOCATION: ${inferDateline(section, topic)}`,
    "",
    body,
    "",
    `PULL_QUOTE: ${pullQuote}`,
    "",
    "SOURCES:",
    ...sources.map((source) => `- ${source}`),
    "",
    `META: ${JSON.stringify({
      bias_score: 0.0,
      tags,
      word_count: wordCount,
      confidence: "medium",
    })}`,
  ].join("\n");
}

async function generateWithClaude(topic, tone, requestedSection, realSources, whyNewsworthy) {
  const promptSources = capSourcesForPrompt(realSources, 5);
  const userMessage = `Topic: "${topic}"
Tone: ${tone}
Tone guidance: ${toneInstructionMap[tone] || toneInstructionMap.Neutral}
Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Why this is newsworthy: ${whyNewsworthy || "Not provided"}
${promptSources?.length > 0 ? `\nReal sources about this topic:\n${promptSources.map(s => `- "${s.title}" — ${s.source}, ${new Date(s.publishedAt).toLocaleDateString()}\n  URL: ${s.url}`).join('\n')}` : ''}

Write a complete hard news article about the most newsworthy current angle on: "${topic}"

If "${topic}" is a single word or short phrase, identify the most newsworthy current story associated with it and write about that specific story — not a general overview.

Every sentence must contain a specific named fact. No generic content. No template phrases. Start with SECTION:`;

  try {
    const text = await callAI(SYSTEM_PROMPT, userMessage, {
      model: ARTICLE_MODEL,
      maxTokens: 2000,
      temperature: toneTemperatureMap[tone] || 1,
    });
    return text || null;
  } catch (error) {
    console.error("[GROQ ERROR]", error.message);
    throw new Error("AI service temporarily unavailable");
  }
}

async function enrichTopicContext(topic) {
  try {
    const text = await callAI(
      null,
      `In one sentence, explain why this is currently newsworthy: ${topic}`,
      {
        model: CHEAP_MODEL,
        maxTokens: 100,
        temperature: 0,
      },
    );

    return String(text || "").slice(0, 280);
  } catch (error) {
    console.error("[GROQ ERROR]", error.message);
    return "";
  }
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = String(payload?.topic || "").trim();
  const tone = String(payload?.tone || "Neutral").trim();
  const section = String(payload?.section || "All").trim();
  const whyNewsworthy = String(payload?.why_newsworthy || payload?.whyNewsworthy || "").trim();
  const requestSources = Array.isArray(payload?.realSources) ? dedupeSources(payload.realSources) : [];
  const requestEmail = String(payload?.requestEmail || payload?.userEmail || "").trim().toLowerCase();
  const shouldEmailRequest = Boolean(payload?.sendRequestedEmail || requestEmail);

  if (shouldEmailRequest) {
    const user = await currentUser();
    const userEmail = String(
      user?.primaryEmailAddress?.emailAddress ||
        user?.emailAddresses?.[0]?.emailAddress ||
        "",
    ).trim().toLowerCase();
    if (!userEmail || userEmail !== requestEmail) {
      return NextResponse.json({ error: "Request email does not match the signed-in account" }, { status: 403 });
    }
  }

  if (!topic) {
    return NextResponse.json({ error: "Topic is required" }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const supabaseConfig = getSupabaseConfig();

  if (supabase && supabaseConfig) {
    const existingSlug = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 60);

    const slugProbe = existingSlug.split("-").slice(0, 3).join("-");

    let existing = null;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const queryGeneratedAt = await supabase
      .from(supabaseConfig.table)
      .select("*")
      .ilike("slug", `%${slugProbe}%`)
      .eq("status", "published")
      .gte("generatedAt", since)
      .limit(1)
      .maybeSingle();

    if (!queryGeneratedAt.error && queryGeneratedAt.data) {
      existing = queryGeneratedAt.data;
    } else {
      const queryCreatedAt = await supabase
        .from(supabaseConfig.table)
        .select("*")
        .ilike("slug", `%${slugProbe}%`)
        .eq("status", "published")
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();

      if (!queryCreatedAt.error && queryCreatedAt.data) {
        existing = queryCreatedAt.data;
      }
    }

    if (existing) {
      return NextResponse.json({ article: existing, cached: true });
    }
  }

  let raw = null;
  let usedFallback = false;
  const realSources = requestSources.length ? requestSources : await fetchRealSources(topic);
  const enrichedWhyNewsworthy = whyNewsworthy || (await enrichTopicContext(topic));

  try {
    raw = await generateWithClaude(topic, tone, section, realSources, enrichedWhyNewsworthy);
  } catch {
    raw = null;
  }

  const verifiedSourceCount = Array.isArray(realSources) ? realSources.length : 0;

  if (!raw) {
    raw = buildFallbackRawArticle(topic, tone, section, realSources);
    usedFallback = true;
  }

  const article = parseArticle(raw);
  if (!article) {
    return NextResponse.json(
      {
        error: "Generated response did not match required format",
        raw,
      },
      { status: 502 },
    );
  }

  const requestedSection = section !== "All" ? section : "";
  const classificationInput = `${topic} | ${article.headline} | ${article.subheadline}`;
  article.section = inferSection(classificationInput, requestedSection);
  article.headline = titleCaseHeadline(article.headline);
  article.meta.tags = normalizeArticleTags(article.meta.tags, article.section);
  console.log("[CATEGORY CLASSIFICATION]", JSON.stringify({
    input: { topic, requestedSection, generatedHeadline: article.headline },
    output: { section: article.section, tags: article.meta?.tags || [] },
  }));

  const image = await fetchArticleImage(topic, article.section);
  article.image = image
    ? {
        url: image.url,
        smallUrl: image.smallUrl,
        alt: image.alt,
        photographer: image.photographer,
        photographerUrl: image.photographerUrl,
      }
    : null;

  article.slug = generateSlug(article.headline);
  article.topic = topic;
  article.consensus = await generateStoredConsensus(topic, `What is the consensus on: ${article.headline}?`, realSources);

  if (usedFallback) {
    article.verification = "unverified";
    article.verificationNote =
      "Sources could not be independently verified. This article is a placeholder draft and must not be treated as a fully-sourced report.";
    article.agentRun = article.agentRun || "pending_review";
    await saveArticleToSupabase(article, { status: "pending_review", verification: "unverified" });
  } else if (verifiedSourceCount < 3) {
    article.verification = "low_coverage";
    article.verificationNote = "Fewer than 3 real sources were available for this topic.";
    await saveArticleToSupabase(article, { status: "pending_review", verification: "low_coverage" });
  } else {
    article.verification = "verified";
    await saveArticleToSupabase(article, { status: "published" });
  }

  if (shouldEmailRequest) {
    await sendRequestedArticleEmail({
      email: requestEmail,
      article,
      articleUrl: new URL(`/story/${article.slug}`, request.url).toString(),
    });

    return NextResponse.json({
      success: true,
      message: "Article generated and sent to your email.",
      article,
    });
  }

  return NextResponse.json({
    article,
    raw,
    usedFallback,
  });
}
