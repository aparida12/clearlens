export const sectionTabs = ["All", "Health", "Science", "Policy", "Economy", "Technology", "Environment", "Law"];

export const toneOptions = ["Neutral", "Investigative", "Explainer", "Scientific"];

export const sampleStories = [];

export function slugifyTopic(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 72);
}

export function titleFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getStoryBySlug(slug) {
  return null;
}
