import { NextResponse } from "next/server";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { discardArticle, getEditorialDashboard, publishArticle } from "@/lib/editorial";

function cleanSlug(value) {
  return String(value || "").trim();
}

export async function GET() {
  try {
    const dashboard = await getEditorialDashboard();
    return NextResponse.json(dashboard);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load admin articles",
        details: String(error?.message || error),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const action = String(body?.action || body?.status || "").toLowerCase();
    let slug = cleanSlug(body?.slug);

    if (!slug && body?.id && isSupabaseConfigured() && supabase) {
      const { data } = await supabase.from("articles").select("slug").eq("id", body.id).maybeSingle();
      slug = cleanSlug(data?.slug);
    }

    if (!slug) {
      return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    }

    if (action === "publish" || action === "approved" || action === "yes") {
      const article = await publishArticle(slug, {
        slackMessage: (resolvedArticle) => `✅ Published: ${resolvedArticle.headline} — manually approved\nhttps://clearlens.ai/story/${resolvedArticle.slug}`,
      });

      return NextResponse.json({
        success: true,
        article,
        message: `✅ Published: ${article.headline} — manually approved`,
      });
    }

    if (action === "discard" || action === "rejected" || action === "no") {
      const article = await discardArticle(slug, {
        slackMessage: (resolvedArticle) => `🗑 Discarded: ${resolvedArticle.headline} — manually rejected`,
      });

      return NextResponse.json({
        success: true,
        article,
        message: `🗑 Discarded: ${article.headline} — manually rejected`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to update article status",
        details: String(error?.message || error),
      },
      { status: 500 },
    );
  }
}
