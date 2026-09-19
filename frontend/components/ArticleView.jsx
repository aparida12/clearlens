"use client";

import Image from "next/image";
import { useState } from "react";

const urlRegex = /https?:\/\/[^\s)]+/i;

function sanitizeText(text) {
  if (!text) return "";
  return String(text)
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[^\x00-\x7F]/g, (char) => {
      const code = char.codePointAt(0);
      if (code > 8000) return "";
      return char;
    })
    .trim();
}

function stripOuterQuotes(text) {
  return String(text || "").trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "").trim();
}

function formatHeadline(value) {
  const smallWords = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
  return String(value || "").trim().split(/\s+/).map((word, index) => {
    const leading = word.match(/^[^A-Za-z0-9]*/)?.[0] || "";
    const trailing = word.match(/[^A-Za-z0-9]*$/)?.[0] || "";
    const core = word.slice(leading.length, word.length - trailing.length || word.length);
    if (!core) return word;
    const lower = core.toLowerCase();
    const formatted = /^[A-Z0-9.]+$/.test(core) && core.length <= 5
      ? core
      : index > 0 && smallWords.has(lower)
        ? lower
        : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    return `${leading}${formatted}${trailing}`;
  }).join(" ");
}

function getHeadlineSize(headline) {
  const length = String(headline || "").trim().length;
  if (length < 50) return "article-headline-size-lg";
  if (length <= 80) return "article-headline-size-md";
  return "article-headline-size-sm";
}

function getSectionAccentClass(section) {
  const value = String(section || "").toLowerCase();
  if (value === "health") return "section-accent-health";
  if (value === "politics") return "section-accent-politics";
  if (value === "science") return "section-accent-science";
  if (value === "economy") return "section-accent-economy";
  if (value === "technology") return "section-accent-technology";
  if (value === "environment") return "section-accent-environment";
  if (value === "law") return "section-accent-law";
  return "section-accent-default";
}

export default function ArticleView({ article, pollData, pollLoading = false }) {
  const [copied, setCopied] = useState(false);
  const hasArticle = Boolean(article && typeof article === "object");
  const safeArticle = hasArticle ? article : {};

  const {
    section = "",
    byline = "",
    date = "",
    location = "",
    image = null,
    sources = [],
    meta = {},
    verification = "verified",
    verificationNote = "",
  } = safeArticle;

  const headline = formatHeadline(sanitizeText(safeArticle?.headline || ""));
  const subheadline = sanitizeText(safeArticle?.subheadline || "");
  const body = sanitizeText(safeArticle?.body || "");
  const pullQuote = sanitizeText(safeArticle?.pullQuote || "");
  const sanitizedSources = Array.isArray(sources) ? sources.map((source) => sanitizeText(source)) : [];

  const isUnverified = verification === "unverified" || verification === "low_coverage";
  const verificationMessage = isUnverified
    ? verificationNote || "Sources could not be independently verified."
    : "";

  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const inferredWordCount = String(body)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const wordCount = Number.isFinite(meta.word_count) ? Number(meta.word_count) : inferredWordCount;
  const bodyParagraphs = String(body)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const headlineSize = getHeadlineSize(headline);
  const normalizedPullQuote = stripOuterQuotes(pullQuote);
  const sectionAccentClass = getSectionAccentClass(section);
  const pollSources = Array.isArray(pollData?.sources) ? pollData.sources : [];
  const pollCounts = {
    agree: pollSources.filter((source) => source?.stance === "agree").length,
    neutral: pollSources.filter((source) => source?.stance === "neutral").length,
    disagree: pollSources.filter((source) => source?.stance === "disagree").length,
  };
  const pollTotal = pollSources.length;

  const copyPayload = [
    `SECTION: ${section}`,
    `HEADLINE: ${headline}`,
    `SUBHEADLINE: ${subheadline}`,
    `BYLINE: ${byline}`,
    `DATE: ${date}`,
    `LOCATION: ${location}`,
    "",
    body,
    "",
    `PULL_QUOTE: ${normalizedPullQuote}`,
    "",
    "SOURCES:",
    ...sanitizedSources.map((source) => `- ${source}`),
  ].join("\n");

  async function copyArticle() {
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (!hasArticle) {
    return null;
  }

  return (
    <article className={`article-view ${sectionAccentClass}`}>
      <div className="article-top-bar" />
      <header className="mb-8 overflow-hidden border border-[var(--rule)] bg-[var(--white)] px-5 py-6 text-center sm:px-6 sm:py-7">
        <span className="article-section-label inline-block">
          {section}
        </span>

        <h1 className={`article-headline mx-auto mt-4 ${headlineSize}`}>
          {headline}
        </h1>

        <p className="article-subheadline mx-auto mt-3">
          {subheadline}
        </p>

        <div className="article-byline-row mt-6">
          <div className="flex flex-col gap-2 text-center sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {wordCount > 0 && <span className="article-meta-pill">{wordCount} words</span>}
              <span>·</span>
              <span>{date}</span>
              {location ? <><span>·</span><span>{location.replace(/\s*[-–—]\s*$/, "")}</span></> : null}
            </div>
          </div>
        </div>
      </header>

      <section className="consensus-bar-wrap" aria-label="Source consensus">
        <div className="consensus-bar-heading">
          <span>Source consensus</span>
          {pollTotal > 0 ? <span>{pollTotal} sources analyzed</span> : null}
        </div>
        {pollTotal > 0 ? (
          <>
            <div className="consensus-bar" role="img" aria-label={`${Math.round((pollCounts.agree / pollTotal) * 100)} percent agree, ${Math.round((pollCounts.neutral / pollTotal) * 100)} percent neutral, ${Math.round((pollCounts.disagree / pollTotal) * 100)} percent disagree`}>
              <span className="consensus-segment consensus-agree" style={{ width: `${(pollCounts.agree / pollTotal) * 100}%` }} />
              <span className="consensus-segment consensus-neutral" style={{ width: `${(pollCounts.neutral / pollTotal) * 100}%` }} />
              <span className="consensus-segment consensus-disagree" style={{ width: `${(pollCounts.disagree / pollTotal) * 100}%` }} />
            </div>
            <div className="consensus-bar-labels">
              <span>Agree {Math.round((pollCounts.agree / pollTotal) * 100)}%</span>
              <span>Neutral {Math.round((pollCounts.neutral / pollTotal) * 100)}%</span>
              <span>Disagree {Math.round((pollCounts.disagree / pollTotal) * 100)}%</span>
            </div>
          </>
        ) : (
          <p className="consensus-bar-fallback">{pollLoading ? "Loading source consensus..." : "Consensus unavailable for this story."}</p>
        )}
      </section>

      {isUnverified && (
        <section className="mx-auto mb-8 w-full max-w-[840px] border-2 border-[#b45309] bg-[#fffbeb] px-5 py-4 text-left">
          <p className="font-ui text-[11px] font-bold uppercase tracking-[0.2em] text-[#b45309]">
            Advisory: Sources Not Independently Verified
          </p>
          <p className="mt-1 font-body text-[15px] leading-[1.6] text-[#7c4a03]">
            {verificationMessage}
          </p>
        </section>
      )}

      {image?.url && (
        <section className="mx-auto mb-8 w-full max-w-[840px]">
          <div className="overflow-hidden border border-[var(--rule)] bg-[var(--surface)]">
            <Image
              src={image.url}
              alt={image.alt || headline || "Article image"}
              width={1200}
              height={675}
              priority
              className="article-hero-image h-auto max-h-[480px] w-full object-cover"
            />
          </div>
          {image.photographer && image.photographerUrl && (
            <p className="article-photo-credit mt-2 text-right text-[10px] text-[#9b9b9b]">
              Photo: {" "}
              <a href={image.photographerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {image.photographer}
              </a>
            </p>
          )}
        </section>
      )}

      {tags.length > 0 && (
        <section className="mx-auto mb-8 flex max-w-[760px] flex-wrap justify-center gap-2 text-center">
          {tags.map((tag) => (
            <span
              key={tag}
              className="article-tag-pill"
            >
              {tag}
            </span>
          ))}
        </section>
      )}

      <section className="article-body mx-auto mb-3 w-full max-w-[800px] text-center" onCopy={(event) => event.preventDefault()}>
        {bodyParagraphs.map((paragraph, index) => (
          <p
            key={`${index}-${paragraph.slice(0, 20)}`}
            className={`mb-[1.4em] break-inside-avoid font-body text-[18px] leading-[1.8] text-[var(--ink)] ${
              index === 0 ? "article-dropcap" : ""
            }`}
          >
            {paragraph}
          </p>
        ))}
      </section>

      <div className="pull-quote relative mx-auto mb-8 mt-8 w-full max-w-[840px] py-5 text-center">
        <span className="pointer-events-none absolute -left-1 -top-10 font-display text-[120px] leading-none text-[var(--accent)] opacity-[0.12]">
          &quot;
        </span>
        <p className="relative mx-auto max-w-[760px] font-display text-[26px] italic leading-[1.35] text-[var(--ink)]">
          {normalizedPullQuote}
        </p>
      </div>

      <section className="sources-box mx-auto mt-8 w-full max-w-[840px] bg-[var(--white)] px-6 py-5 text-center">
        <h3 className="mb-4 font-ui text-[10px] uppercase tracking-[0.25em] text-[var(--ink-3)]">Sources &amp; Methodology</h3>
        {isUnverified ? (
          <p className="font-body text-[15px] leading-[1.6] text-[#7c4a03]">
            Sources for this draft could not be independently verified. Citation lines shown here are provisional placeholders, not confirmed sources, and should not be relied upon.
          </p>
        ) : (
          <ul className="text-left">
            {sanitizedSources.map((source, index) => {
              const sourceText = String(source || "").trim();
              const url = sourceText.match(urlRegex)?.[0] || "";
              const textWithoutUrl = url ? sourceText.replace(url, "").trim() : sourceText;

              return (
                <li
                  key={`${index}-${sourceText.slice(0, 22)}`}
                  className="border-b-[0.5px] border-[#f2f0ec] py-2 font-ui text-[12px] leading-[1.6] text-[var(--ink-3)] last:border-b-0"
                >
                  <span>{textWithoutUrl || sourceText}</span>
                  {url && (
                    <>
                      {" "}
                      <a
                        className="text-[var(--accent-blue)] underline underline-offset-2"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {url}
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="mx-auto mt-5 flex w-full max-w-[840px] flex-col gap-3 border-t border-[var(--rule)] pt-4 font-ui text-[11px] text-[var(--ink-4)] text-center sm:flex-row sm:items-center sm:justify-between">
        <span>Generated by ClearLens AI</span>
        <button
          type="button"
          onClick={copyArticle}
          className="article-copy-button"
        >
          {copied ? "Copied" : "Copy Article"}
        </button>
      </footer>
    </article>
  );
}