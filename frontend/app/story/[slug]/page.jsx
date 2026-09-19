import StoryArticleClient from "@/components/StoryArticleClient";
import { getArticleBySlug } from "@/lib/supabaseArticles";
import { getAgentArticles } from "@/lib/agent";

function normalizeSlug(value) {
  try {
    return decodeURIComponent(String(value || "")).trim().toLowerCase();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

async function resolveStory(slug) {
  const article = await getArticleBySlug(slug);
  if (article) return article;

  const normalizedSlug = normalizeSlug(slug);
  const feed = await getAgentArticles({ category: "All", limit: 120 });
  return (
    feed.find((item) => normalizeSlug(item?.slug) === normalizedSlug) || null
  );
}

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const slug = String(resolvedParams?.slug || "");
  const article = await resolveStory(slug);

  if (!article) {
    return {
      title: "Story not found",
      description: "ClearLens story page",
    };
  }

  return {
    title: article.headline || "ClearLens Story",
    description: article.subheadline || "AI-generated story from ClearLens",
  };
}

export default async function StoryPage({ params }) {
  const resolvedParams = await params;
  const slug = String(resolvedParams?.slug || "");
  const article = await resolveStory(slug);

  if (!article) {
    return (
      <main className="story-not-found-wrap page-container">
        <p className="story-not-found">Story not found</p>
      </main>
    );
  }

  return <StoryArticleClient article={article} />;
}
