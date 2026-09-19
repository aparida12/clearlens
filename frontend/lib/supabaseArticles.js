import { createClient } from "@supabase/supabase-js";
import { readArticles, writeArticles } from "@/lib/articleStore";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const table = process.env.SUPABASE_ARTICLES_TABLE || "articles";

  if (!url || !key) return null;
  return { url, key, table };
}

function getSupabaseClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  if (process.env.SUPABASE_LOCAL_ONLY === "true") return null;
  const timeoutMs = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS) || 3000;
  const timedFetch = async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...(init || {}), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    fetch: timedFetch,
  });
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  if (record.article && typeof record.article === "object") {
    const embedded = record.article;
    return {
      ...embedded,
      slug: record.slug || embedded.slug,
      topic: record.topic || embedded.topic || "",
      status: record.status || embedded.status || "published",
      verification: record.verification || embedded.verification || "verified",
      qualityScore: Number(record.qualityscore ?? record.qualityScore ?? embedded.qualityScore ?? 0) || null,
      qualityIssues: record.qualityissues ?? record.qualityIssues ?? embedded.qualityIssues ?? [],
      agentRun: record.agentrun || record.agentRun || embedded.agentRun || null,
      generatedAt: record.generatedat || record.generatedAt || embedded.generatedAt || record.created_at || embedded.createdAt || null,
    };
  }

  return {
    id: record.id || null,
    slug: record.slug || "",
    topic: record.topic || "",
    section: record.section || "",
    headline: record.headline || "",
    subheadline: record.subheadline || "",
    byline: record.byline || "",
    date: record.date || "",
    location: record.location || "",
    body: record.body || "",
    pullQuote: record.pull_quote || record.pullQuote || "",
    sources: Array.isArray(record.sources) ? record.sources : [],
    meta: record.meta && typeof record.meta === "object" ? record.meta : {},
    image: record.image && typeof record.image === "object" ? record.image : null,
    status: record.status || "published",
    verification: record.verification || "verified",
    qualityScore: Number(record.qualityscore ?? record.qualityScore ?? 0) || null,
    qualityIssues: record.qualityissues ?? record.qualityIssues ?? [],
    agentRun: record.agentrun || record.agentRun || null,
    generatedAt: record.generatedat || record.generatedAt || record.created_at || record.createdAt || null,
    createdAt: record.created_at || record.createdAt || null,
  };
}

async function upsertLocalArticle(articleLike) {
  const slug = String(articleLike?.slug || "").trim();
  if (!slug) return;
  const existing = await readArticles();
  const normalized = normalizeRecord(articleLike) || articleLike;
  const next = [...existing];
  const idx = next.findIndex((item) => String(item?.slug || "") === slug);
  if (idx >= 0) next[idx] = { ...next[idx], ...normalized };
  else next.unshift(normalized);
  await writeArticles(next);
}

async function getPublishedFromLocal({ category, limit } = {}) {
  const max = Number.parseInt(String(limit || ""), 10);
  let items = (await readArticles())
    .map(normalizeRecord)
    .filter(Boolean)
    .filter((row) => String(row?.status || "published") === "published")
    .filter((row) => String(row?.headline || "").trim().length > 0);

  if (category && String(category).toLowerCase() !== "all") {
    items = items.filter(
      (row) => String(row?.section || "").toLowerCase() === String(category).toLowerCase(),
    );
  }

  if (Number.isFinite(max) && max > 0) {
    items = items.slice(0, max);
  }

  return items;
}

async function upsertRow(client, table, row, onConflict = "slug") {
  return client.from(table).upsert(row, { onConflict });
}

export async function getArticleBySlug(slug) {
  const cleanSlug = String(slug || "").trim();
  if (!cleanSlug) return null;

  const fromLocal = async () => {
    const local = (await readArticles())
      .map(normalizeRecord)
      .filter(Boolean)
      .find((row) => String(row?.slug || "").trim() === cleanSlug);
    return local || null;
  };

  const client = getSupabaseClient();
  const config = getSupabaseConfig();
  if (!client || !config) return fromLocal();

  const { data, error } = await client
    .from(config.table)
    .select("*")
    .eq("slug", cleanSlug)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return fromLocal();

  const normalized = normalizeRecord(data);
  if (normalized) return normalized;
  return fromLocal();
}

export async function getRecentHeadlines(limit = 20) {
  const client = getSupabaseClient();
  const config = getSupabaseConfig();
  if (!client || !config) {
    const local = await getPublishedFromLocal({ limit });
    return local.map((row) => String(row?.headline || "").trim()).filter(Boolean);
  }

  const { data, error } = await client
    .from(config.table)
    .select("headline")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!error && Array.isArray(data)) {
    return data.map((row) => String(row?.headline || "").trim()).filter(Boolean);
  }

  // Older schemas may not have a top-level status column.
  const fallback = await client
    .from(config.table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit * 5);

  if (fallback.error || !Array.isArray(fallback.data)) {
    const local = await getPublishedFromLocal({ limit });
    return local.map((row) => String(row?.headline || "").trim()).filter(Boolean);
  }
  const published = fallback.data
    .map(normalizeRecord)
    .filter((row) => String(row?.status || "published") === "published")
    .slice(0, limit);

  return published.map((row) => String(row?.headline || "").trim()).filter(Boolean);
}

export async function getPublishedArticles({ category, limit } = {}) {
  const client = getSupabaseClient();
  const config = getSupabaseConfig();
  if (!client || !config) return getPublishedFromLocal({ category, limit });

  const max = Number.parseInt(String(limit || ""), 10);
  let query = client
    .from(config.table)
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (category && String(category).toLowerCase() !== "all") {
    query = query.ilike("section", String(category));
  }

  if (Number.isFinite(max) && max > 0) {
    query = query.limit(max);
  }

  const { data, error } = await query;
  if (!error && Array.isArray(data)) {
    const normalized = data
      .map(normalizeRecord)
      .filter(Boolean)
      .filter((row) => String(row?.headline || "").trim().length > 0);
    if (normalized.length > 0) return normalized;
    return getPublishedFromLocal({ category, limit });
  }

  // Older schemas may not have a top-level status column.
  let fallbackQuery = client
    .from(config.table)
    .select("*")
    .order("created_at", { ascending: false });

  if (Number.isFinite(max) && max > 0) {
    fallbackQuery = fallbackQuery.limit(max * 4);
  }

  const fallback = await fallbackQuery;
  if (fallback.error || !Array.isArray(fallback.data)) {
    return getPublishedFromLocal({ category, limit });
  }

  let normalized = fallback.data
    .map(normalizeRecord)
    .filter(Boolean)
    .filter((row) => String(row?.status || "published") === "published")
    .filter((row) => String(row?.headline || "").trim().length > 0);

  if (category && String(category).toLowerCase() !== "all") {
    normalized = normalized.filter(
      (row) => String(row?.section || "").toLowerCase() === String(category).toLowerCase(),
    );
  }

  if (Number.isFinite(max) && max > 0) {
    normalized = normalized.slice(0, max);
  }

  return normalized.length > 0
    ? normalized
    : getPublishedFromLocal({ category, limit });
}

export async function saveArticleToSupabase(article, options = {}) {
  if (!article || typeof article !== "object") return;

  const status = String(options?.status || "published");
  const verification = String(options?.verification || article.verification || "verified");

  await upsertLocalArticle({ ...article, status, verification });

  const client = getSupabaseClient();
  const config = getSupabaseConfig();
  if (!client || !config) return;

  const rowCamel = {
    slug: article.slug,
    topic: article.topic || "",
    section: article.section,
    headline: article.headline,
    subheadline: article.subheadline,
    byline: article.byline,
    date: article.date,
    location: article.location,
    body: article.body,
    pullQuote: article.pullQuote,
    sources: article.sources,
    meta: article.meta,
    image: article.image,
    status,
    verification,
    qualityScore: null,
    qualityIssues: [],
    agentRun: article.agentRun || null,
    generatedAt: article.generatedAt || new Date().toISOString(),
  };

  const rowLower = {
    slug: article.slug,
    topic: article.topic || "",
    section: article.section,
    headline: article.headline,
    subheadline: article.subheadline,
    byline: article.byline,
    date: article.date,
    location: article.location,
    body: article.body,
    pull_quote: article.pullQuote,
    sources: article.sources,
    meta: article.meta,
    image: article.image,
    status,
    verification,
    qualityscore: null,
    qualityissues: [],
    agentrun: article.agentRun || null,
    generatedat: article.generatedAt || new Date().toISOString(),
  };

  const primary = await upsertRow(client, config.table, rowCamel);
  if (!primary.error) return;

  const secondary = await upsertRow(client, config.table, rowLower);
  if (!secondary.error) return;

  await upsertRow(client, config.table, {
    slug: article.slug,
    topic: article.topic || "",
    article,
  });
}

export async function saveAgentArticleToSupabase({ article, status, qualityScore, qualityIssues, agentRun }) {
  if (!article || typeof article !== "object") return;

  const client = getSupabaseClient();
  const config = getSupabaseConfig();
  if (!client || !config) return;

  const issues = Array.isArray(qualityIssues) ? qualityIssues : [];
  const score = Number.isFinite(Number(qualityScore)) ? Number(qualityScore) : null;
  const publicationStatus = String(status || "published");
  const verification = String(article.verification || "verified");

  await upsertLocalArticle({
    ...article,
    status: publicationStatus,
    verification,
    qualityScore: score,
    qualityIssues: issues,
    agentRun,
  });

  const rowCamel = {
    slug: article.slug,
    topic: article.topic || article.headline || "",
    section: article.section,
    headline: article.headline,
    subheadline: article.subheadline,
    byline: article.byline,
    date: article.date,
    location: article.location,
    body: article.body,
    pullQuote: article.pullQuote,
    sources: article.sources,
    meta: article.meta,
    image: article.image,
    status: publicationStatus,
    verification,
    qualityScore: score,
    qualityIssues: issues,
    agentRun,
    generatedAt: article.generatedAt || new Date().toISOString(),
  };

  const rowLower = {
    slug: article.slug,
    topic: article.topic || article.headline || "",
    section: article.section,
    headline: article.headline,
    subheadline: article.subheadline,
    byline: article.byline,
    date: article.date,
    location: article.location,
    body: article.body,
    pull_quote: article.pullQuote,
    sources: article.sources,
    meta: article.meta,
    image: article.image,
    status: publicationStatus,
    verification,
    qualityscore: score,
    qualityissues: issues,
    agentrun: agentRun,
    generatedat: article.generatedAt || new Date().toISOString(),
  };

  const primary = await upsertRow(client, config.table, rowCamel);
  if (!primary.error) return;

  const secondary = await upsertRow(client, config.table, rowLower);
  if (!secondary.error) return;

  await upsertRow(client, config.table, {
    slug: article.slug,
    topic: article.topic || article.headline || "",
    article: {
      ...article,
      status: publicationStatus,
      verification,
      qualityScore: score,
      qualityIssues: issues,
      agentRun,
    },
  });
}

export { getSupabaseClient, getSupabaseConfig, normalizeRecord };
