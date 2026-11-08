import { NextResponse } from "next/server";
import { getAgentArticles } from "@/lib/agent";

export const dynamic = "force-dynamic";

async function getRssFallback() {
  const feeds = [
    ["https://www.who.int/rss-feeds/news-english.xml", "World Health Organization"],
    ["https://feeds.bbci.co.uk/news/health/rss.xml", "BBC News"],
  ];
  const articles = [];

  for (const [url, source] of feeds) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const xml = await response.text();
      for (const match of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6)) {
        const item = match[1];
        const value = (tag) => {
          const found = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
          return found
            ? found[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim()
            : "";
        };
        const headline = value("title");
        if (!headline) continue;
        articles.push({
          slug: headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          topic: headline,
          section: "Health",
          headline,
          subheadline: value("description"),
          byline: source,
          date: new Date().toISOString().slice(0, 10),
          body: value("description"),
          sources: [`${source}: ${value("link")}`],
          status: "published",
          verification: "source-linked",
          generatedAt: value("pubDate") || new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("[RSS FEED]", error.message);
    }
  }

  return articles;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "All";
    const limit = searchParams.get("limit") || "";
    const articles = await getAgentArticles({ category, limit });

    return NextResponse.json(
      { articles: articles.length ? articles : await getRssFallback() },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        articles: [],
        error: String(error?.message || error),
      },
      { status: 500 },
    );
  }
}
