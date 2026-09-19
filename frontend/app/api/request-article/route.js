import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { sendArticleEmail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getUserEmail(user) {
  return (
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    ""
  ).trim();
}

async function generateRequestedArticle({ topic, tone, requestUrl }) {
  const response = await fetch(new URL("/api/generate", requestUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, tone, section: "All" }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to generate article");
  }

  if (!payload?.article) {
    throw new Error("Generated article was empty");
  }

  return payload.article;
}

export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const user = await currentUser();
  const email = getUserEmail(user);
  if (!email) {
    return NextResponse.json({ error: "No email address found on your account" }, { status: 400 });
  }

  const topic = String(body?.topic || "").trim();
  const tone = String(body?.tone || "Neutral").trim();

  if (!topic) {
    return NextResponse.json({ error: "Topic is required" }, { status: 400 });
  }

  try {
    const article = await generateRequestedArticle({ topic, tone, requestUrl: request.url });
    const articleUrl = new URL(`/story/${article.slug}`, request.url).toString();

    await sendArticleEmail({
      to: email,
      article,
      articleUrl,
    });

    return NextResponse.json({
      success: true,
      message: `Your requested article on ${topic} has been generated and emailed to ${email}.`,
      article,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: String(error?.message || error),
      },
      { status: 500 },
    );
  }
}
