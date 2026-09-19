import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { sendSlack } from "@/lib/slack";
import { normalizeRecord } from "@/lib/supabaseArticles";

function cleanSlug(slug) {
  return String(slug || "").trim();
}

function getTodayStartIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function sourcesCount(article) {
  return Array.isArray(article?.sources) ? article.sources.length : 0;
}

function generatedAtValue(article) {
  return article?.generatedAt || article?.generatedat || article?.created_at || article?.createdAt || null;
}

function sortByGeneratedAtDescending(left, right) {
  const leftTime = Date.parse(String(generatedAtValue(left) || 0));
  const rightTime = Date.parse(String(generatedAtValue(right) || 0));
  return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
}

async function fetchArticleBySlug(slug) {
  const clean = cleanSlug(slug);
  if (!clean || !isSupabaseConfigured() || !supabase) return null;

  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .eq("slug", clean)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeRecord(data);
}

export async function publishArticle(slug, options = {}) {
  const article = await fetchArticleBySlug(slug);
  if (!article) throw new Error("Article not found");

  const { error } = await supabase
    .from("articles")
    .update({ status: "published" })
    .eq("slug", article.slug);

  if (error) throw new Error(String(error.message || error));

  if (options.slackMessage !== false) {
    const message = typeof options.slackMessage === "function"
      ? options.slackMessage(article)
      : options.slackMessage || `✅ Published: ${article.headline}\nhttps://clearlens.ai/story/${article.slug}`;
    await sendSlack(message);
  }

  return article;
}

export async function discardArticle(slug, options = {}) {
  const article = await fetchArticleBySlug(slug);
  if (!article) throw new Error("Article not found");

  const { error } = await supabase
    .from("articles")
    .update({ status: "discarded" })
    .eq("slug", article.slug);

  if (error) throw new Error(String(error.message || error));

  if (options.slackMessage !== false) {
    const message = typeof options.slackMessage === "function"
      ? options.slackMessage(article)
      : options.slackMessage || `🗑 Discarded: ${article.headline}`;
    await sendSlack(message);
  }

  return article;
}

export async function getEditorialDashboard() {
  if (!isSupabaseConfigured() || !supabase) {
    return {
      autoPublishedToday: [],
      holdQueue: [],
      manualReview: [],
    };
  }

  const todayStartIso = getTodayStartIso();

  const [publishedTodayResponse, pendingResponse] = await Promise.all([
    supabase
      .from("articles")
      .select("*")
      .eq("status", "published")
      .gte("generatedAt", todayStartIso),
    supabase
      .from("articles")
      .select("*")
      .eq("status", "pending"),
  ]);

  const publishedToday = Array.isArray(publishedTodayResponse.data)
    ? publishedTodayResponse.data.map(normalizeRecord).filter(Boolean).sort(sortByGeneratedAtDescending)
    : [];

  const pending = Array.isArray(pendingResponse.data)
    ? pendingResponse.data.map(normalizeRecord).filter(Boolean)
    : [];

  const holdQueue = pending
    .filter((article) => {
      const score = toNumber(article?.qualityScore ?? article?.qualityscore);
      const count = sourcesCount(article);
      return (score >= 7 && score <= 8) || (count >= 3 && count <= 4);
    })
    .sort(sortByGeneratedAtDescending);

  const manualReview = pending
    .filter((article) => toNumber(article?.qualityScore ?? article?.qualityscore) === 6)
    .sort(sortByGeneratedAtDescending);

  return {
    autoPublishedToday: publishedToday,
    holdQueue,
    manualReview,
  };
}

export function getEditorialArticleMeta(article) {
  return {
    generatedAt: generatedAtValue(article),
    sourcesCount: sourcesCount(article),
    qualityScore: toNumber(article?.qualityScore ?? article?.qualityscore),
  };
}