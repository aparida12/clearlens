export function generateSlug(headline) {
  return String(headline || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 80);
}

export default generateSlug;