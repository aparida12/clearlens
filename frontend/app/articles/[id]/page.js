import { redirect } from "next/navigation";
import { slugifyTopic, titleFromSlug } from "@/lib/editorialStories";

export default async function LegacyArticleRedirectPage({ params }) {
  const resolvedParams = await params;
  const legacyId = String(resolvedParams?.id || "").trim();
  const slug = slugifyTopic(legacyId) || "public-health";
  const topic = titleFromSlug(slug) || "Public Health";
  const query = new URLSearchParams({
    topic,
    section: "Health",
    tone: "Neutral",
  }).toString();

  redirect(`/story/${slug}?${query}`);
}
