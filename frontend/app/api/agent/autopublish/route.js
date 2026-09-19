import { supabase } from "@/lib/supabase";
import { publishArticle } from "@/lib/editorial";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const secret = request.headers.get("x-agent-secret");
  if (secret !== process.env.AGENT_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: pendingArticles, error } = await supabase
    .from("articles")
    .select("*")
    .eq("status", "pending")
    .gte("qualityScore", 7)
    .lte("qualityScore", 8)
    .lt("generatedAt", twoHoursAgo);

  if (error || !pendingArticles?.length) {
    return Response.json({ autopublished: 0 });
  }

  let count = 0;

  for (const article of pendingArticles) {
    await publishArticle(article.slug, {
      slackMessage: `⏰ *Auto-published after 2hr hold:* ${article.headline}\nScore: ${article.qualityScore}/10\nhttps://clearlens.ai/story/${article.slug}`,
    });
    count += 1;
  }

  return Response.json({ autopublished: count });
}