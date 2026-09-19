const UNSPLASH_API = "https://api.unsplash.com/search/photos";
const recentlyUsedImageUrls = new Set();

function normalizeImage(photo) {
  if (!photo?.urls?.regular || !photo?.urls?.small) return null;

  const photographer = String(photo?.user?.name || "").trim();
  const profileBase = String(photo?.user?.links?.html || "").trim();
  const profileUrl = profileBase
    ? `${profileBase}${profileBase.includes("?") ? "&" : "?"}utm_source=clearlens&utm_medium=referral`
    : "";

  return {
    url: photo.urls.regular,
    smallUrl: photo.urls.small,
    alt: String(photo.alt_description || photo.description || "Editorial image"),
    photographer,
    photographerUrl: profileUrl,
  };
}

async function searchUnsplash(query, accessKey) {
  const endpoint = new URL(UNSPLASH_API);
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("orientation", "landscape");
  endpoint.searchParams.set("per_page", "5");
  endpoint.searchParams.set("client_id", accessKey);

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: { "accept-version": "v1" },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (!results.length) return null;

  const queryHash = [...String(query)].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 7);
  const startIndex = queryHash % results.length;
  for (let offset = 0; offset < results.length; offset += 1) {
    const image = normalizeImage(results[(startIndex + offset) % results.length]);
    if (image && !recentlyUsedImageUrls.has(image.url)) {
      recentlyUsedImageUrls.add(image.url);
      if (recentlyUsedImageUrls.size > 100) recentlyUsedImageUrls.delete(recentlyUsedImageUrls.values().next().value);
      return image;
    }
  }
  const fallbackImage = normalizeImage(results[startIndex]);
  if (fallbackImage) recentlyUsedImageUrls.add(fallbackImage.url);
  return fallbackImage;
}

export async function fetchArticleImage(topic, section) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return null;

  const topicQuery = String(topic || "").trim();
  const sectionQuery = String(section || "").trim();

  try {
    if (topicQuery) {
      const byTopic = await searchUnsplash(`${topicQuery} news editorial`, accessKey);
      if (byTopic) return byTopic;
    }

    if (sectionQuery) {
      const bySection = await searchUnsplash(sectionQuery, accessKey);
      if (bySection) return bySection;
    }

    return null;
  } catch {
    return null;
  }
}
