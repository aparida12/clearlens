const GENERIC_TERMS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "case", "cases", "for", "from", "global", "health", "in", "into", "is", "it", "new", "news", "of", "on", "or", "people", "public", "report", "research", "study", "the", "this", "to", "update", "with", "year", "years",
]);

export function cleanConsensusText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTerm(value) {
  const term = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (term.length > 5 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 5 && term.endsWith("s")) return term.slice(0, -1);
  return term;
}

export function buildAffirmativeClaim(title, explicitClaim = "") {
  const claim = cleanConsensusText(explicitClaim);
  if (claim) return claim;
  const storyTitle = cleanConsensusText(title).replace(/\s+-\s+[^-]+$/, "");
  return `The factual claim reported by this story is: ${storyTitle}.`;
}

export function isRelevantConsensusSource(source, claim) {
  const claimText = cleanConsensusText(claim).replace(/^The factual claim reported by this story is:\s*/i, "");
  const sourceText = cleanConsensusText(`${source?.title || ""} ${source?.description || source?.summary || ""}`);
  if (!sourceText) return false;
  const claimTerms = new Set(
    claimText
      .split(/\s+/)
      .map(normalizeTerm)
      .filter((term) => term.length >= 4 && !GENERIC_TERMS.has(term)),
  );
  const sourceTerms = new Set(sourceText.split(/\s+/).map(normalizeTerm));
  const overlap = [...claimTerms].filter((term) => sourceTerms.has(term));
  return overlap.length >= 2;
}
