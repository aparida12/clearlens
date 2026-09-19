export function parseArticle(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const text = raw.replace(/\r\n?/g, "\n").trim();

  const pattern =
    /^SECTION:\s*(.+)\nHEADLINE:\s*(.+)\nSUBHEADLINE:\s*(.+)\nBYLINE:\s*(.+)\nDATE:\s*(.+)\nLOCATION:\s*(.+)\n+([\s\S]*?)\n+PULL_QUOTE:\s*(.+)\n+SOURCES:\n([\s\S]*?)\n+META:\s*(\{[\s\S]*\})\s*$/;
  const match = text.match(pattern);

  if (!match) {
    return null;
  }

  const [, section, headline, subheadline, byline, date, location, bodyRaw, pullQuote, sourcesRaw, metaRaw] = match;

  const body = bodyRaw.trim();
  if (!body) {
    return null;
  }

  const sources = sourcesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);

  if (sources.length === 0) {
    return null;
  }

  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return null;
  }

  if (
    !meta ||
    typeof meta !== "object" ||
    typeof meta.bias_score !== "number" ||
    !Array.isArray(meta.tags) ||
    typeof meta.word_count !== "number" ||
    typeof meta.confidence !== "string"
  ) {
    return null;
  }

  return {
    section: section.trim(),
    headline: headline.trim(),
    subheadline: subheadline.trim(),
    byline: byline.trim(),
    date: date.trim(),
    location: location.trim(),
    body,
    pullQuote: pullQuote.trim(),
    sources,
    meta,
  };
}

export default parseArticle;
