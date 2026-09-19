import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { parseArticle } from "@/lib/parseArticle";
import { generateSlug } from "@/lib/generateSlug";
import { sendSlack } from "@/lib/slack";
import { callAI, CHEAP_MODEL, capSourcesForPrompt } from "@/lib/groq";
import { getPublishedArticles, getRecentHeadlines, saveAgentArticleToSupabase } from "@/lib/supabaseArticles";
import { ensureStoreFiles, readQueue, readStatus, writeQueue, writeStatus } from "@/lib/articleStore";

const MAX_SELECTIONS = 5;
const DAILY_CAP = 12;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const POSITIVE_SENTIMENT_TERMS = [
  "improve",
  "improves",
  "improved",
  "breakthrough",
  "approved",
  "decline",
  "decrease",
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
  "decline",
  "concern",
  "contamination",
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function estimateSentimentScore(text) {
  const normalized = cleanText(text).toLowerCase();
  if (!normalized) return 0;

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

function overlapRatio(a, b) {
  const left = new Set(cleanText(a).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const right = new Set(cleanText(b).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / Math.max(left.size, right.size);
}

function dedupeByTitleSimilarity(headlines, threshold = 0.82) {
  const selected = [];
  for (const item of headlines) {
    const title = cleanText(item?.title || item?.headline);
    if (!title) continue;
    const duplicate = selected.some((existing) => overlapRatio(existing.headline, title) >= threshold);
    if (duplicate) continue;
    selected.push({
      headline: title,
      source: cleanText(item?.source || item?.outlet || "Unknown"),
      description: cleanText(item?.description || ""),
      url: cleanText(item?.url || ""),
      publishedAt: cleanText(item?.publishedAt || ""),
      sentimentScore:
        typeof item?.sentimentScore === "number"
          ? item.sentimentScore
          : estimateSentimentScore(`${title} ${cleanText(item?.description || "")}`),
      sentimentLabel:
        typeof item?.sentimentLabel === "string" && item.sentimentLabel
          ? item.sentimentLabel
          : sentimentLabelFromScore(
              typeof item?.sentimentScore === "number"
                ? item.sentimentScore
                : estimateSentimentScore(`${title} ${cleanText(item?.description || "")}`),
            ),
    });
  }
  return selected;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function callClaude({ prompt, maxTokens = 1200, temperature = 0.1, model }) {
  try {
    return await callAI(null, prompt, {
      model: model || CHEAP_MODEL,
      maxTokens,
      temperature,
    });
  } catch (error) {
    console.error("[GROQ ERROR]", error.message);
    throw new Error("AI service temporarily unavailable");
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTopHeadlines() {
  const requests = [
    {
      url: `https://newsapi.org/v2/top-headlines?language=en&pageSize=30&apiKey=${process.env.NEWS_API_KEY || ""}`,
      parser: (payload) =>
        Array.isArray(payload?.articles)
          ? payload.articles.map((item) => ({
              title: item?.title,
              description: item?.description,
              source: item?.source?.name,
              url: item?.url,
              publishedAt: item?.publishedAt,
            }))
          : [],
    },
    {
      url: `https://gnews.io/api/v4/top-headlines?lang=en&max=20&apikey=${process.env.GNEWS_API_KEY || ""}`,
      parser: (payload) =>
        Array.isArray(payload?.articles)
          ? payload.articles.map((item) => ({
              title: item?.title,
              description: item?.description,
              source: item?.source?.name,
              url: item?.url,
              publishedAt: item?.publishedAt,
            }))
          : [],
    },
    {
      url: `https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY || ""}`,
      parser: (payload) =>
        Array.isArray(payload)
          ? payload.slice(0, 25).map((item) => ({
              title: item?.headline,
              description: item?.summary,
              source: item?.source,
              url: item?.url,
              publishedAt: item?.datetime ? new Date(item.datetime * 1000).toISOString() : "",
            }))
          : [],
    },
    {
      url: `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&sort=LATEST&limit=30&apikey=${process.env.ALPHAVANTAGE_API_KEY || ""}`,
      parser: (payload) =>
        Array.isArray(payload?.feed)
          ? payload.feed.map((item) => ({
              title: item?.title,
              description: item?.summary,
              source: item?.source || "Alpha Vantage",
              url: item?.url,
              publishedAt: item?.time_published || "",
              sentimentScore:
                typeof item?.overall_sentiment_score === "number"
                  ? Math.max(-1, Math.min(1, item.overall_sentiment_score))
                  : undefined,
              sentimentLabel:
                typeof item?.overall_sentiment_label === "string"
                  ? String(item.overall_sentiment_label).toLowerCase().includes("bull")
                    ? "positive"
                    : String(item.overall_sentiment_label).toLowerCase().includes("bear")
                      ? "negative"
                      : "neutral"
                  : undefined,
            }))
          : [],
    },
  ];

  const settled = await Promise.allSettled(requests.map((request) => fetchJson(request.url)));
  const collected = [];

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const request = requests[index];
    if (result.status === "fulfilled") {
      collected.push(...request.parser(result.value));
    } else {
      console.error(`[HEADLINE FETCH] API ${index} failed:`, result.reason?.message || String(result.reason));
    }
  }

  console.log(`[HEADLINE FETCH] Collected ${collected.length} headlines from news APIs`);

  if (!collected.length) {
    throw new Error("No headlines fetched from any API.");
  }

  const deduped = dedupeByTitleSimilarity(collected);
  const averageSentiment =
    deduped.length > 0
      ? deduped.reduce((sum, item) => sum + (item.sentimentScore || 0), 0) / deduped.length
      : 0;
  console.log(`[HEADLINE FETCH] After deduplication: ${deduped.length} headlines`);
  console.log(`[HEADLINE FETCH] Average sentiment score: ${averageSentiment.toFixed(3)}`);
  return deduped;
}

function formatHeadlinesForPrompt(headlines) {
  return headlines.map((item) => `- ${item.headline}${item.source ? ` (${item.source})` : ""}`).join("\n");
}

function formatRecentHeadlinesForPrompt(headlines) {
  if (!headlines.length) return "- none";
  return headlines.map((item) => `- ${item}`).join("\n");
}

function inferCategoryFromHeadline(headline) {
  const value = cleanText(headline).toLowerCase();
  if (/(nfl|football|contract extension|touchdown|quarterback|nba|soccer|world cup)/.test(value)) return "Sports";
  if (/(movie|film|cinema|box office|actor|actress|television|tv series)/.test(value)) return "Entertainment";
  if (/(court|judge|lawsuit|ruling|legal)/.test(value)) return "Law";
  if (/(climate|air quality|wildfire|heat wave|environment)/.test(value)) return "Environment";
  if (/(election|parliament|policy|regulation|minister|government)/.test(value)) return "Policy";
  if (/(market|inflation|economy|cost|budget|trade|tariff)/.test(value)) return "Economy";
  if (/(ai|technology|tech|chip|software|cyber)/.test(value)) return "Technology";
  if (/(study|trial|vaccine|hospital|disease|health|medical)/.test(value)) return "Health";
  if (/(war|military|missile|iran|ukraine|ceasefire|diplomatic)/.test(value)) return "World";
  return "World";
}

function titleCaseHeadline(value) {
  const smallWords = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
  return cleanText(value).split(" ").map((word, index) => {
    const lower = word.toLowerCase();
    if (/^[A-Z0-9.]+$/.test(word) && word.length <= 5) return word;
    return index > 0 && smallWords.has(lower) ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }).join(" ");
}

function fallbackSelectTopics(headlines, recentPublishedHeadlines) {
  const recentSet = new Set((recentPublishedHeadlines || []).map((item) => cleanText(item).toLowerCase()));
  const selected = [];
  for (const item of headlines) {
    const headline = cleanText(item?.headline || item?.title);
    if (!headline) continue;
    const tooSimilarToRecent = [...recentSet].some((recent) => overlapRatio(recent, headline.toLowerCase()) >= 0.75);
    const tooSimilarToSelected = selected.some((existing) => overlapRatio(existing.headline_hint, headline) >= 0.75);
    if (tooSimilarToRecent || tooSimilarToSelected) continue;
    selected.push({
      topic: headline,
      headline_hint: headline,
      category: inferCategoryFromHeadline(headline),
      urgency: "developing",
      why: "Selected via deterministic fallback while AI topic selector is unavailable.",
      question_for_poll: `What is your view on: ${headline}?`,
    });
    if (selected.length >= MAX_SELECTIONS) break;
  }
  return selected;
}

async function selectTopics(headlines, recentPublishedHeadlines) {
  const { selectedTopics } = await selectTopicsWithDebug(headlines, recentPublishedHeadlines);
  return selectedTopics;
}

async function selectTopicsWithDebug(headlines, recentPublishedHeadlines) {
  const promptHeadlines = capSourcesForPrompt(headlines, 40);
  const prompt = `You are the editor of a world-class newspaper. From the headlines below pick exactly 5 stories to assign to writers. 

Selection criteria — the story MUST have all of these:
- A named entity (person, company, drug, law, country, institution)
- A specific stakes (money amount, health outcome, legal ruling, election result, scientific finding)
- Cross-source coverage (multiple outlets covering it)
- Newsworthiness today specifically — not evergreen background

Reject anything:
- Vague or generic ('experts say', 'officials warn', 'studies show')
- Pure opinion or editorial
- Celebrity gossip or entertainment
- Already covered in recent articles (list provided below)

Recent article headlines already published (do not repeat these topics):
${formatRecentHeadlinesForPrompt(recentPublishedHeadlines)}

Headlines from today:
${formatHeadlinesForPrompt(promptHeadlines)}

Return ONLY this JSON, nothing else:
{
  selected: [
    {
      topic: string,
      headline_hint: string,
      category: string,
      urgency: 'breaking'|'trending'|'developing',
      why: string,
      question_for_poll: string
    }
  ]
}`;

  let responseText = "";
  try {
    responseText = await callClaude({ prompt, maxTokens: 2000, temperature: 0.1 });
  } catch (error) {
    const fallbackTopics = fallbackSelectTopics(headlines, recentPublishedHeadlines);
    return {
      selectedTopics: fallbackTopics,
      debug: {
        mode: "fallback_topic_selector",
        reason: String(error?.message || error),
        selectedCount: fallbackTopics.length,
        headlinesCount: headlines.length,
      },
    };
  }
  
  const parsed = extractJson(responseText);
  const selected = Array.isArray(parsed?.selected) ? parsed.selected : [];
  
  const mapped = selected
    .map((item) => ({
      topic: cleanText(item?.topic),
      headline_hint: cleanText(item?.headline_hint),
      category: inferCategoryFromHeadline(`${item?.topic || ""} ${item?.headline_hint || ""}`),
      urgency: ["breaking", "trending", "developing"].includes(item?.urgency) ? item.urgency : "developing",
      why: cleanText(item?.why),
      question_for_poll: cleanText(item?.question_for_poll),
    }))
    .filter((item) => item.topic)
    .slice(0, MAX_SELECTIONS);
  
  const debug = {
    llmResponseLength: responseText.length,
    llmResponseFull: responseText,
    extractJsonResult: parsed ? "JSON extracted successfully" : "extractJson returned null",
    selectedCount: selected.length,
    mappedCount: mapped.length,
    headlinesCount: headlines.length,
  };
  
  return { selectedTopics: mapped, debug };
}

export async function selectTopTopics(headlines, recentPublishedHeadlines = []) {
  return selectTopics(headlines, recentPublishedHeadlines);
}

async function fetchTopicNewsApiSources(topic) {
  if (!process.env.NEWS_API_KEY) return [];

  const endpoint = new URL("https://newsapi.org/v2/everything");
  endpoint.searchParams.set("q", topic);
  endpoint.searchParams.set("sortBy", "relevance");
  endpoint.searchParams.set("pageSize", "8");
  endpoint.searchParams.set("apiKey", process.env.NEWS_API_KEY);

  try {
    const payload = await fetchJson(endpoint.toString());
    if (!Array.isArray(payload?.articles)) return [];
    return payload.articles.map((item) => ({
      title: cleanText(item?.title),
      description: cleanText(item?.description),
      url: cleanText(item?.url),
      source: cleanText(item?.source?.name || "Unknown"),
      publishedAt: cleanText(item?.publishedAt),
    }));
  } catch {
    return [];
  }
}

function buildScoringPrompt(article) {
  return `You are a senior editor at The New York Times. Score this article strictly on publication readiness.

Headline: ${article.headline}
Subheadline: ${article.subheadline}
Opening paragraph: ${article.body?.split('\n\n')[0]}
Source count: ${article.sources?.length || 0}
Sources: ${article.sources?.slice(0,3).join(' | ')}

SCORING RUBRIC — be strict, most articles should score 6-8:

9-10 (auto-publish worthy):
- Headline contains a specific named entity AND a number or concrete outcome
- Opening paragraph has a real statistic, real person, or real event with date
- 4+ named credible sources directly relevant to this exact topic
- Zero generic phrases
- Could run in Reuters or NYT today without edits

7-8 (good but hold briefly):
- Headline is specific but missing a number or concrete outcome
- Opening paragraph is specific but could be stronger
- 3-4 sources, mostly relevant
- Minor generic passages but majority is specific
- Solid article, just not exceptional

6 (marginal, needs human eyes):
- Headline is somewhat specific but vague
- Some generic passages mixed with specific ones
- Only 3 sources or some sources feel tangential
- Reads more like a summary than hard news

5 or below (discard):
- Headline contains banned phrases (enters new phase, faces scrutiny, moves into focus)
- Opening paragraph is generic or could apply to any topic
- Fewer than 3 sources or sources are irrelevant
- Body is mostly template language
- Would embarrass the publication

Return ONLY this JSON, nothing else:
{"score": number, "issues": ["specific issue 1", "specific issue 2"], "strongest_element": "what works best"}`;
}

async function scoreForPublication(article) {
  try {
    const responseText = await callClaude({
      prompt: buildScoringPrompt(article),
      maxTokens: 150,
      temperature: 0,
    });
    const parsed = extractJson(responseText);
    const scoreRaw = Number(parsed?.score);
    const score = Number.isFinite(scoreRaw) ? Math.max(1, Math.min(10, Math.round(scoreRaw))) : 0;
    const issues = Array.isArray(parsed?.issues) ? parsed.issues.map((issue) => cleanText(issue)).filter(Boolean) : [];
    return { score, issues };
  } catch (error) {
    const sourcesCount = sourcesCountForArticle(article);
    const bodyLength = cleanText(article?.body || "").length;
    let score = 6;
    if (sourcesCount >= 4 && bodyLength > 1200) score = 8;
    else if (sourcesCount >= 3 && bodyLength > 900) score = 7;
    else if (sourcesCount <= 1 || bodyLength < 500) score = 5;
    return {
      score,
      issues: [
        "AI scoring unavailable; used deterministic fallback scoring.",
        `Fallback reason: ${String(error?.message || error)}`,
      ],
    };
  }
}

export async function scoreArticle(article) {
  return scoreForPublication(article);
}

function determineTier(score, sourcesCount) {
  const numericScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  const numericSources = Number.isFinite(Number(sourcesCount)) ? Number(sourcesCount) : 0;
  if (numericScore >= 8 && numericSources >= 3) return "published";
  if ((numericScore >= 7 && numericScore <= 8) || (numericSources >= 3 && numericSources <= 4)) return "pending_hold";
  if (numericScore === 6) return "pending_review";
  return "discarded";
}

function sourcesCountForArticle(article) {
  return Array.isArray(article?.sources) ? article.sources.length : 0;
}

function issuesText(issues) {
  return Array.isArray(issues) && issues.length ? issues.join(", ") : "none listed";
}

async function generateArticleForTopic(baseUrl, topicSpec) {
  const topicSources = await fetchTopicNewsApiSources(topicSpec.topic);

  const response = await fetch(new URL("/api/generate", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topicSpec.topic,
      tone: "Neutral",
      section: topicSpec.category,
      realSources: topicSources,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Generate failed for ${topicSpec.topic}: ${response.status} ${details}`);
  }

  const payload = await response.json();
  const raw = payload?.raw;
  const parsed = parseArticle(raw);
  if (!parsed) return null;

  const verification =
    payload?.article?.verification ||
    (payload?.usedFallback ? "unverified" : "verified");

  if (verification === "unverified" || verification === "low_coverage") {
    parsed.verification = verification;
    parsed.verificationNote =
      "Sources could not be independently verified. This article is a placeholder draft and must not be treated as a fully-sourced report.";
  }

  return {
    ...parsed,
    id: randomUUID(),
    slug: generateSlug(parsed.headline),
    topic: topicSpec.topic,
    pollQuestion: topicSpec.question_for_poll || `What is the consensus on: ${parsed.headline}?`,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateArticle(topicSpec, baseUrl) {
  return generateArticleForTopic(baseUrl, topicSpec);
}

async function publishOrQueue(article, quality, runId, { isTest = false } = {}) {
  const sourcesCount = sourcesCountForArticle(article);
  const verification = String(article?.verification || "verified");

  if (verification === "unverified" || verification === "low_coverage") {
    if (!isTest) {
      await saveAgentArticleToSupabase({
        article,
        status: "pending_review",
        qualityScore: quality.score,
        qualityIssues: [
          ...(Array.isArray(quality?.issues) ? quality.issues : []),
          "Sources could not be independently verified — forced to manual review. Must not be auto-published.",
        ],
        agentRun: runId,
      });
      await sendSlack(`⚠️ *Unverified sources — needs review:* ${article.headline}\nScore: ${quality.score}/10 | Verification: ${verification} | Will NOT auto-publish. Manual approval required.\nApprove: /editorial yes ${article.slug}\nDiscard: /editorial no ${article.slug}`);
    }
    return { decision: "pending", sourcesCount, verification };
  }

  const tier = determineTier(quality.score, sourcesCount);

  if (tier === "published") {
    if (!isTest) {
      await saveAgentArticleToSupabase({
        article,
        status: "published",
        qualityScore: quality.score,
        qualityIssues: quality.issues,
        agentRun: runId,
      });
      await sendSlack(`✅ *Auto-published:* ${article.headline}\nScore: ${quality.score}/10 | Sources: ${sourcesCount} | ${article.section}\nhttps://clearlens.ai/story/${article.slug}`);
    }
    return { decision: "published", sourcesCount };
  }

  if (tier === "pending_hold") {
    if (!isTest) {
      await saveAgentArticleToSupabase({
        article,
        status: "pending",
        qualityScore: quality.score,
        qualityIssues: quality.issues,
        agentRun: runId,
      });
      await sendSlack(`⏳ *2-hour hold:* ${article.headline}\nScore: ${quality.score}/10 | Auto-publishes in 2 hours unless you act.\nApprove now: /editorial yes ${article.slug}\nDiscard: /editorial no ${article.slug}`);
    }
    return { decision: "pending", sourcesCount };
  }

  if (tier === "pending_review") {
    if (!isTest) {
      await saveAgentArticleToSupabase({
        article,
        status: "pending",
        qualityScore: quality.score,
        qualityIssues: quality.issues,
        agentRun: runId,
      });
      await sendSlack(`👀 *Needs review:* ${article.headline}\nScore: ${quality.score}/10 | Will NOT auto-publish. Manual approval required.\nIssues: ${issuesText(quality.issues)}\nApprove: /editorial yes ${article.slug}\nDiscard: /editorial no ${article.slug}`);
    }
    return { decision: "pending", sourcesCount };
  }

  if (!isTest) {
    await saveAgentArticleToSupabase({
      article,
      status: "discarded",
      qualityScore: quality.score,
      qualityIssues: quality.issues,
      agentRun: runId,
    });
    await sendSlack(`🗑 *Auto-discarded:* ${article.headline}\nScore: ${quality.score}/10 | Reason: ${issuesText(quality.issues)}`);
  }

  return { decision: "discarded", sourcesCount };
}

function buildQueueJob(topics) {
  return { id: randomUUID(), createdAt: new Date().toISOString(), topics };
}

export async function run({ baseUrl, test = false } = {}) {
  await ensureStoreFiles();
  const startedAt = new Date().toISOString();
  const existingStatus = await readStatus();
  await writeStatus({ ...existingStatus, status: "running", lastError: null });

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const today = new Date().toISOString().split("T")[0];
      let count = 0;

      const byGeneratedAt = await supabase.from("articles").select("*", { count: "exact", head: true }).gte("generatedAt", today);
      if (!byGeneratedAt.error) {
        count = Number(byGeneratedAt.count || 0);
      } else {
        const byCreatedAt = await supabase.from("articles").select("*", { count: "exact", head: true }).gte("created_at", `${today}T00:00:00.000Z`);
        count = Number(byCreatedAt.count || 0);
      }

      if (count >= DAILY_CAP) {
        return { skipped: true, reason: "daily cap reached", count, success: true, counts: { autopublished: 0, held: 0, needsReview: 0, discarded: 0 }, articles: [] };
      }
    }

    const topHeadlines = await fetchTopHeadlines();
    const recentPublishedHeadlines = await getRecentHeadlines(20);
    const { selectedTopics, debug } = await selectTopicsWithDebug(topHeadlines, recentPublishedHeadlines);

    if (!selectedTopics.length) {
      const err = new Error(`Topic selection returned no publishable topics. Fetched ${topHeadlines.length} headlines, selected 0 topics.`);
      err.debugInfo = debug;
      throw err;
    }

    const articles = [];
    let autopublished = 0;
    let held = 0;
    let needsReview = 0;
    let discarded = 0;

    for (const topicSpec of selectedTopics) {
      let article = null;
      try {
        article = await generateArticleForTopic(baseUrl, topicSpec);
      } catch (error) {
        discarded += 1;
        await sendSlack(`🗑 *Discarded:* ${topicSpec.headline_hint || topicSpec.topic}\nScore: 0/10 | Reason: ${String(error?.message || error)}`);
        await delay(2000);
        continue;
      }

      if (!article) {
        discarded += 1;
        await sendSlack(`🗑 *Discarded:* ${topicSpec.headline_hint || topicSpec.topic}\nScore: 0/10 | Reason: parseArticle returned null`);
        await delay(2000);
        continue;
      }

      article.generatedAt = new Date().toISOString();
      const quality = await scoreForPublication(article);
      const outcome = await publishOrQueue(article, quality, startedAt, { isTest: test });

      if (outcome.decision === "published") autopublished += 1;
      if (outcome.decision === "pending") {
        if (Number(quality.score || 0) === 6) needsReview += 1;
        else held += 1;
      }
      if (outcome.decision === "discarded") discarded += 1;

      articles.push({
        topic: topicSpec.topic,
        headline: titleCaseHeadline(article.headline),
          section: article.section,
          tags: article.meta?.tags || [],
        score: quality.score,
        decision: outcome.decision,
        preview: article.body.substring(0, 220),
        issues: quality.issues,
        sourcesCount: outcome.sourcesCount,
        slug: article.slug,
      });

      await delay(2000);
    }

    if (!test) {
      await sendSlack(`*ClearLens Agent Run Complete — ${new Date().toLocaleTimeString()}*\n✅ Auto-published: ${autopublished}\n⏳ 2hr hold: ${held}\n👀 Needs review: ${needsReview}\n🗑 Discarded: ${discarded}\nNext run in 6 hours.`);
    }

    await writeStatus({ lastRun: startedAt, articlesGenerated: autopublished, topicsAnalyzed: selectedTopics.length, status: "idle", lastError: null });

    return { success: true, isTest: test, articles, counts: { autopublished, held, needsReview, discarded }, topics: selectedTopics.map((topic) => topic.topic), topicsAnalyzed: selectedTopics.length, articlesGenerated: autopublished };
  } catch (error) {
    const message = String(error?.message || error);
    await writeStatus({ lastRun: startedAt, articlesGenerated: 0, topicsAnalyzed: 0, status: "error", lastError: message });
    if (!test) {
      await sendSlack(`*ClearLens Agent Run Complete*\nPublished: 0 | Pending: 0 | Discarded: 0\nRun failed: ${message}\nNext run in 6 hours.`);
    }
    const result = { success: false, articlesGenerated: 0, topicsAnalyzed: 0, topics: [], error: message, counts: { autopublished: 0, held: 0, needsReview: 0, discarded: 0 }, articles: [] };
    if (test && error?.debugInfo) {
      result.debugInfo = error.debugInfo;
    }
    return result;
  }
}

export async function runAgentCycle({ baseUrl, test = false } = {}) {
  return run({ baseUrl, test });
}

export async function queueAgentRun(topics) {
  await ensureStoreFiles();
  const queue = await readQueue();
  const job = buildQueueJob(topics);
  queue.push(job);
  await writeQueue(queue);
  return job;
}

export async function getAgentStatus() {
  await ensureStoreFiles();
  return readStatus();
}

export async function getAgentArticles({ category, limit } = {}) {
  return getPublishedArticles({ category, limit });
}

export { parseArticle };
