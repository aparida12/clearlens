import { NextResponse } from "next/server";
import { discardArticle, publishArticle } from "@/lib/editorial";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.text();
  const params = new URLSearchParams(body);
  const text = params.get("text")?.trim().toLowerCase();
  const token = params.get("token");

  if (token !== process.env.SLACK_VERIFICATION_TOKEN) {
    return NextResponse.json({ text: "Unauthorized" }, { status: 401 });
  }

  if (!text) {
    return NextResponse.json({ text: "Usage: yes [slug] or no [slug]" });
  }

  const commandText = text.replace(/^\/editorial\s+/, "");
  const parts = commandText.split(/\s+/);
  const action = parts[0];
  const slug = parts[1];

  if (!slug) {
    return NextResponse.json({ text: "Please provide a slug. Usage: yes [slug] or no [slug]" });
  }

  if (action === "yes") {
    const article = await publishArticle(slug, {
      slackMessage: (resolvedArticle) => `✅ Published: ${resolvedArticle.headline} — manually approved\nhttps://clearlens.ai/story/${resolvedArticle.slug}`,
    });

    return NextResponse.json({
      text: `✅ Published: ${article.headline} — manually approved\nhttps://clearlens.ai/story/${slug}`,
    });
  }

  if (action === "no") {
    const article = await discardArticle(slug, {
      slackMessage: (resolvedArticle) => `🗑 Discarded: ${resolvedArticle.headline} — manually rejected`,
    });

    return NextResponse.json({
      text: `🗑 Discarded: ${article.headline} — manually rejected`,
    });
  }

  return NextResponse.json({ text: "Unknown command. Use yes [slug] or no [slug]" });
}
