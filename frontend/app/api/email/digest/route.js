import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getSectionColorHex } from "@/lib/sectionColors";
import { normalizeRecord } from "@/lib/supabaseArticles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeList(values) {
  return Array.from(
    new Set(
      Array.isArray(values)
        ? values.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : [],
    ),
  );
}

function qualityValue(article) {
  const score = Number(article?.qualityScore ?? article?.qualityscore ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function createdAtValue(article) {
  const ts = Date.parse(String(article?.createdAt || article?.date || 0));
  return Number.isNaN(ts) ? 0 : ts;
}

function sortByQualityThenDate(articles) {
  return articles.slice().sort((a, b) => {
    const scoreDiff = qualityValue(b) - qualityValue(a);
    if (scoreDiff !== 0) return scoreDiff;
    return createdAtValue(b) - createdAtValue(a);
  });
}

function firstParagraphExcerpt(body) {
  const firstParagraph = String(body || "").split(/\n\s*\n/)[0].trim();
  if (!firstParagraph) return "";
  if (firstParagraph.length <= 220) return firstParagraph;
  return `${firstParagraph.slice(0, 220).trimEnd()}...`;
}

function uniqueBySlug(articles) {
  const seen = new Set();
  const output = [];

  for (const article of articles) {
    const key = String(article?.slug || article?.headline || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(article);
  }

  return output;
}

function selectDigestArticlesForSubscriber(subscriber, weeklyArticles, generalTopArticles) {
  const sections = normalizeList(subscriber?.sections);
  const wantsAll = sections.length === 0 || sections.includes("all");

  if (wantsAll) {
    const selected = uniqueBySlug(generalTopArticles.slice(0, 5));
    return selected;
  }

  const selected = [];
  for (const section of sections) {
    const sectionMatches = weeklyArticles
      .filter((article) => String(article?.section || "").trim().toLowerCase() === section)
      .slice(0, 3);
    selected.push(...sectionMatches);
  }

  const uniqueSelected = uniqueBySlug(selected);
  if (uniqueSelected.length >= 5) {
    return uniqueSelected.slice(0, 5);
  }

  const filler = generalTopArticles.filter((article) => {
    const key = String(article?.slug || article?.headline || "").toLowerCase();
    return !uniqueSelected.some((item) => String(item?.slug || item?.headline || "").toLowerCase() === key);
  });

  return uniqueBySlug([...uniqueSelected, ...filler]).slice(0, 5);
}

function formatDateRange(startDate, endDate) {
  const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${short.format(startDate)} - ${short.format(endDate)}`;
}

function formatSubjectDate(endDate) {
  const long = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
  return long.format(endDate);
}

function buildArticleBlock(article) {
  const section = String(article?.section || "News");
  const headline = String(article?.headline || "Untitled");
  const subheadline = String(article?.subheadline || "");
  const excerpt = firstParagraphExcerpt(article?.body || "");
  const slug = String(article?.slug || "");
  const sectionColor = getSectionColorHex(section);

  return `
  <div style="padding: 24px 40px; border-bottom: 0.5px solid #d4cfc8; background: white;">
    <p style="font-family: sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 2.5px; color: ${escapeHtml(sectionColor)}; margin: 0 0 8px;">${escapeHtml(section)}</p>
    <h2 style="font-family: Georgia, serif; font-size: 22px; font-weight: 700; line-height: 1.2; color: #1a1a1a; margin: 0 0 8px;">${escapeHtml(headline)}</h2>
    <p style="font-size: 14px; font-style: italic; color: #6b6b6b; line-height: 1.5; margin: 0 0 12px;">${escapeHtml(subheadline)}</p>
    <p style="font-size: 14px; line-height: 1.7; color: #3d3d3d; margin: 0 0 16px;">${escapeHtml(excerpt)}</p>
    <a href="https://clearlens.ai/story/${encodeURIComponent(slug)}" style="font-family: sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #1a1a1a; text-decoration: none; border-bottom: 1px solid #1a1a1a; padding-bottom: 2px;">Read full article</a>
  </div>`;
}

function buildDigestHtml({ email, articles, dateRange }) {
  const articleBlocks = articles.map((article) => buildArticleBlock(article)).join("\n");
  return `
<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #faf9f7; padding: 0;">
  <div style="background: white; border-bottom: 3px solid #1a1a1a; padding: 28px 40px; text-align: center;">
    <h1 style="font-family: Georgia, serif; font-size: 42px; font-weight: 700; letter-spacing: -2px; margin: 0; color: #1a1a1a;">ClearLens</h1>
    <p style="font-size: 10px; text-transform: uppercase; letter-spacing: 4px; color: #9b9b9b; margin: 6px 0 0;">Independent · Evidence-Based · Machine-Reported</p>
  </div>

  <div style="background: #f2f0ec; border-bottom: 1px solid #d4cfc8; padding: 16px 40px; display: flex; justify-content: space-between;">
    <span style="font-family: sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #6b6b6b;">Weekly Digest</span>
    <span style="font-family: sans-serif; font-size: 11px; color: #9b9b9b;">${escapeHtml(dateRange)}</span>
  </div>

  <div style="padding: 24px 40px 16px; border-bottom: 0.5px solid #d4cfc8;">
    <p style="font-size: 15px; font-style: italic; color: #3d3d3d; line-height: 1.6; margin: 0;">Here are the most important stories ClearLens published this week in your areas of interest.</p>
  </div>

  ${articleBlocks}

  <div style="padding: 28px 40px; background: #faf9f7; border-top: 1px solid #d4cfc8;">
    <p style="font-family: sans-serif; font-size: 11px; color: #9b9b9b; line-height: 1.8; margin: 0;">
      You're receiving this weekly digest because you subscribed to ClearLens.<br>
      <a href="https://clearlens.ai/unsubscribe?email=${encodeURIComponent(email)}" style="color: #c9243f;">Unsubscribe</a> · <a href="https://clearlens.ai" style="color: #9b9b9b;">Visit ClearLens</a>
    </p>
  </div>
</div>`;
}

async function getWeeklyPublishedArticles(weekStartIso) {
  const table = process.env.SUPABASE_ARTICLES_TABLE || "articles";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("status", "published")
    .gte("created_at", weekStartIso)
    .order("created_at", { ascending: false });

  if (error || !Array.isArray(data)) {
    return [];
  }

  return sortByQualityThenDate(data.map(normalizeRecord).filter(Boolean));
}

async function authorizeRequest(request) {
  const secret = request.headers.get("x-agent-secret");
  if (secret && process.env.AGENT_SECRET && secret === process.env.AGENT_SECRET) {
    return true;
  }

  const user = await currentUser();
  return Boolean(user);
}

export async function POST(request) {
  if (!isSupabaseConfigured() || !supabase) {
    return NextResponse.json({ success: false, error: "Supabase is not configured" }, { status: 500 });
  }

  const authorized = await authorizeRequest(request);
  if (!authorized) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ success: false, error: "RESEND_API_KEY is missing" }, { status: 500 });
  }

  const resend = new Resend(resendKey);

  const endDate = new Date();
  const weekStart = new Date(endDate);
  weekStart.setDate(endDate.getDate() - 7);
  const weekStartIso = weekStart.toISOString();

  const { data: subscribers, error: subscribersError } = await supabase
    .from("subscriptions")
    .select("email, sections, active")
    .eq("active", true);

  if (subscribersError) {
    return NextResponse.json({ success: false, error: String(subscribersError.message || subscribersError) }, { status: 500 });
  }

  const weeklyArticles = await getWeeklyPublishedArticles(weekStartIso);
  const generalTopArticles = weeklyArticles.slice(0, 5);

  let sent = 0;
  let skipped = 0;

  const digestSubjectDate = formatSubjectDate(endDate);
  const dateRange = formatDateRange(weekStart, endDate);

  const activeSubscribers = Array.isArray(subscribers) ? subscribers : [];

  for (let index = 0; index < activeSubscribers.length; index += BATCH_SIZE) {
    const batch = activeSubscribers.slice(index, index + BATCH_SIZE);

    await Promise.all(
      batch.map(async (subscriber) => {
        const email = String(subscriber?.email || "").trim().toLowerCase();
        if (!email) {
          skipped += 1;
          return;
        }

        const digestArticles = selectDigestArticlesForSubscriber(subscriber, weeklyArticles, generalTopArticles);
        if (digestArticles.length < 2) {
          skipped += 1;
          return;
        }

        const html = buildDigestHtml({
          email,
          articles: digestArticles,
          dateRange,
        });

        try {
          await resend.emails.send({
            from: "ClearLens <hello@clearlens.ai>",
            to: email,
            subject: `Your ClearLens Weekly Digest — ${digestSubjectDate}`,
            html,
          });
          sent += 1;
        } catch {
          skipped += 1;
        }
      }),
    );

    if (index + BATCH_SIZE < activeSubscribers.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return NextResponse.json({ success: true, sent, skipped });
}
