import React from "react";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export default function ArticleView({ article }) {
  if (!article || typeof article !== "object") {
    return null;
  }

  const {
    section = "",
    headline = "",
    subheadline = "",
    byline = "",
    date = "",
    location = "",
    body = "",
    pullQuote = "",
    sources = [],
    meta = {},
  } = article;

  const bias = typeof meta.bias_score === "number" ? clamp(meta.bias_score, -1, 1) : 0;
  const biasPercent = ((bias + 1) / 2) * 100;
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const confidence = typeof meta.confidence === "string" ? meta.confidence : "unknown";
  const bodyParagraphs = String(body)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className="bg-white text-black">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Source+Serif+4:opsz,wght@8..60,300;8..60,400;8..60,500;8..60,600&display=swap');`}</style>

      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <div className="border-t border-black/25 pt-6 text-center">
            <h1
              className="text-5xl leading-none sm:text-6xl"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              ClearLens
            </h1>
          </div>
          <div className="mt-4 border-b border-black/25" />
        </header>

        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-700">{section}</p>
        </div>

        <h2
          className="mb-4 text-4xl font-bold leading-tight sm:text-5xl"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          {headline}
        </h2>

        <p
          className="mb-8 text-xl font-light italic leading-relaxed text-black/80"
          style={{ fontFamily: '"Source Serif 4", Georgia, serif' }}
        >
          {subheadline}
        </p>

        <div
          className="mb-8 flex flex-col gap-3 border-y border-black/20 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          style={{ fontFamily: '"Source Serif 4", Georgia, serif' }}
        >
          <div className="font-semibold">{byline}</div>
          <div className="text-black/70">
            {date}
            {date && location ? " | " : ""}
            {location}
          </div>
        </div>

        <div className="mb-8 rounded-sm border border-black/15 p-4 sm:p-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.14em]">Bias Score</span>
            <span className="text-sm font-medium">{bias.toFixed(1)}</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 via-slate-100 to-red-600">
            <span
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-black/40 bg-white shadow"
              style={{ left: `calc(${biasPercent}% - 8px)` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] uppercase tracking-[0.12em] text-black/55">
            <span>Left</span>
            <span>Neutral</span>
            <span>Right</span>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-black/20 px-3 py-1 text-xs uppercase tracking-[0.08em]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <section
          className="mb-10 md:columns-2 md:gap-12"
          style={{ fontFamily: '"Source Serif 4", Georgia, serif' }}
        >
          {bodyParagraphs.map((paragraph, index) => (
            <p
              key={`${index}-${paragraph.slice(0, 20)}`}
              className={`mb-5 break-inside-avoid text-[1.15rem] leading-8 ${
                index === 0
                  ? "first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-6xl first-letter:font-semibold first-letter:leading-[0.85]"
                  : ""
              }`}
            >
              {paragraph}
            </p>
          ))}
        </section>

        <blockquote
          className="mb-10 border-y border-black/25 py-8 text-3xl italic leading-tight text-black/90 sm:text-4xl"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          {pullQuote}
        </blockquote>

        <section className="mb-8" style={{ fontFamily: '"Source Serif 4", Georgia, serif' }}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-black/70">Sources</h3>
          <ul className="space-y-2 text-[1.02rem] leading-7">
            {sources.map((source, index) => (
              <li key={`${index}-${source.slice(0, 16)}`}>{source}</li>
            ))}
          </ul>
        </section>

        <footer className="pt-2">
          <span className="inline-flex rounded-full border border-black/25 px-3 py-1 text-xs uppercase tracking-[0.1em]">
            Confidence: {confidence}
          </span>
        </footer>
      </div>
    </article>
  );
}
