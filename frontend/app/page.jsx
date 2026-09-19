"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import SiteHeader from "@/components/SiteHeader";
import SubscriptionWidget from "@/components/SubscriptionWidget";

const sectionItems = ["All", "Health", "Politics", "Science", "Economy", "Technology", "Environment", "Law", "World", "Sports", "Entertainment"];

function resolveSectionFromQuery(searchParams) {
  const initialSection = String(searchParams.get("section") || "all").trim().toLowerCase();
  const matched = sectionItems.find((item) => item.toLowerCase() === initialSection);
  return matched || "All";
}

function getHeadlineSize(headline) {
  const length = String(headline || "").trim().length;
  if (length < 50) return "headline-size-lg";
  if (length <= 80) return "headline-size-md";
  return "headline-size-sm";
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

function getCardDate(article) {
  return String(article?.date || article?.createdAt || article?.generatedAt || article?.publishedAt || "").trim();
}

function getCardByline(article) {
  return String(article?.byline || article?.source || "ClearLens Staff").trim();
}

function getCardDeck(article) {
  const subheadline = String(article?.subheadline || article?.deck || article?.summary || "").trim();
  if (subheadline) return subheadline;

  const body = String(article?.body || "").trim();
  if (!body) return "";

  return body.split(/\n\s*\n/)[0].trim().slice(0, 180);
}

function getSearchableText(article) {
  const tags = Array.isArray(article?.meta?.tags) ? article.meta.tags.join(" ") : "";
  const section = String(article?.section || "");
  const headline = String(article?.headline || "");
  const subheadline = String(article?.subheadline || "");
  const topic = String(article?.topic || "");
  return [headline, subheadline, topic, section, tags].join(" ").toLowerCase();
}

function sortNewestFirst(a, b) {
  const left = Date.parse(String(a?.createdAt || a?.publishedAt || a?.date || 0));
  const right = Date.parse(String(b?.createdAt || b?.publishedAt || b?.date || 0));
  return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-[var(--ink-4)]">
      <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function FeedCard({ article, priority = false }) {
  const section = String(article?.section || article?.category || "News").trim() || "News";
  const headline = String(article?.headline || article?.title || "Untitled").trim() || "Untitled";
  const deck = getCardDeck(article);
  const byline = getCardByline(article);
  const date = getCardDate(article);
  const image = article?.image && typeof article.image === "object" ? article.image : null;
  const headlineSize = getHeadlineSize(headline);
  const sectionAccentClass = getSectionAccentClass(section);
  const slug = String(article?.slug || "").trim();
  const href = slug ? `/story/${slug}` : "/";

  return (
    <Link href={href} className={`article-card card-body group ${sectionAccentClass}`} aria-label={`Open story: ${headline}`}>
      {image?.smallUrl || image?.url ? (
        <Image
          src={image.smallUrl || image.url}
          alt={image.alt || headline}
          width={800}
          height={450}
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 400px"
          priority={priority}
          className="card-image"
        />
      ) : (
        <div className="card-image-placeholder" aria-hidden="true" />
      )}

      <div className="card-section">{section}</div>
      <h3 className={`card-headline ${headlineSize}`}>{headline}</h3>
      {deck ? <p className="card-deck">{deck}</p> : null}
      <div className="card-byline">
        <span>{byline}</span>
        <span>{date}</span>
      </div>
    </Link>
  );
}

function HomePageContent() {
  const searchParams = useSearchParams();
  const { user } = useUser();
  const userEmail = useMemo(
    () =>
      String(
        user?.primaryEmailAddress?.emailAddress ||
          user?.emailAddresses?.[0]?.emailAddress ||
          "",
      ).trim().toLowerCase(),
    [user],
  );

  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activeSection, setActiveSection] = useState("All");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestTopic, setRequestTopic] = useState("");
  const [requestTone, setRequestTone] = useState("Neutral");
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    setActiveSection(resolveSectionFromQuery(searchParams));
  }, [searchParams]);

  useEffect(() => {
    let isActive = true;

    async function loadArticles() {
      try {
        const response = await fetch("/api/agent/articles");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load articles.");
        }

        if (!isActive) return;
        setArticles(Array.isArray(payload?.articles) ? payload.articles.slice().sort(sortNewestFirst) : []);
        setLoadError("");
      } catch (error) {
        if (!isActive) return;
        setArticles([]);
        setLoadError(String(error?.message || "Failed to load articles."));
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }

    loadArticles();

    return () => {
      isActive = false;
    };
  }, []);

  const filteredArticles = useMemo(() => {
    const query = appliedSearch.trim().toLowerCase();
    const section = activeSection.toLowerCase();

    return articles
      .filter((article) => {
        const articleSection = String(article?.section || "").trim().toLowerCase();
        const sectionMatch = section === "all" || articleSection === section;
        const searchMatch = !query || getSearchableText(article).includes(query);
        return sectionMatch && searchMatch;
      })
      .slice()
      .sort(sortNewestFirst);
  }, [articles, appliedSearch, activeSection]);

  async function handleSearchSubmit(event) {
    event.preventDefault();
    setAppliedSearch(searchInput.trim());
  }

  async function handleRequestArticle(event) {
    event.preventDefault();
    const topic = requestTopic.trim();
    if (!topic) return;

    setRequestLoading(true);
    setRequestError("");
    setRequestMessage("");

    if (!userEmail) {
      setRequestError("No email address is available on your account.");
      setRequestLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          tone: requestTone,
          section: "All",
          requestEmail: userEmail,
          sendRequestedEmail: true,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to request article.");
      }

      if (payload?.article) {
        setArticles((current) => [payload.article, ...current.filter((article) => article?.slug !== payload.article.slug)].sort(sortNewestFirst));
      }

      setRequestMessage(String(payload?.message || "Article generated and sent to your email."));
      setRequestTopic("");
      setRequestTone("Neutral");
    } catch (error) {
      setRequestError(String(error?.message || "Failed to request article."));
    } finally {
      setRequestLoading(false);
    }
  }

  const emptyMessage = appliedSearch
    ? `No articles found for "${appliedSearch}".`
    : activeSection !== "All"
      ? `No articles found in ${activeSection}.`
      : "New articles are published throughout the day. Check back soon.";

  function handleSectionChange(section) {
    setActiveSection(section);
  }

  return (
    <div id="home" className="page-shell">
      <SiteHeader activePage="home" activeSection={activeSection} onSectionChange={handleSectionChange} />

      <main className="pb-16">
        <section className="pt-6">
          <div className="search-bar">
            <div className="page-container">
              <form onSubmit={handleSearchSubmit} className="search-form">
                <div className="relative w-full">
                  <span className="search-icon pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
                    <SearchGlyph />
                  </span>
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search articles, topics, and sections"
                    aria-label="Search articles"
                    className="search-input w-full"
                  />
                </div>
              </form>
            </div>
          </div>

          <nav className="tab-bar mt-6">
            <div className="page-container nav-shell flex justify-end">
              <button
                type="button"
                onClick={() => setRequestOpen((current) => !current)}
                className={`tab-item ${requestOpen ? "active" : ""}`}
              >
                REQUEST ARTICLE
              </button>
            </div>
          </nav>

          {requestOpen ? (
            <div className="page-container">
              <form onSubmit={handleRequestArticle} className="paper-panel paper-panel-form mt-5">
                <div className="paper-panel-grid">
                  <div className="col-span-full">
                    <p className="font-ui text-[11px] uppercase tracking-[0.22em] text-[var(--ink-4)]">Article request</p>
                    <h2 className="mt-2 font-display text-[28px] leading-[1.1] text-[var(--ink)]">Request an article</h2>
                  </div>
                  <div className="col-span-full md:col-span-2">
                    <input
                      value={requestTopic}
                      onChange={(event) => setRequestTopic(event.target.value)}
                      placeholder="Topic"
                      className="search-input"
                    />
                  </div>
                  <div className="col-span-full md:col-span-1">
                    <select
                      value={requestTone}
                      onChange={(event) => setRequestTone(event.target.value)}
                      className="tone-select"
                    >
                      <option value="Neutral">Neutral</option>
                      <option value="Investigative">Investigative</option>
                      <option value="Explainer">Explainer</option>
                      <option value="Scientific">Scientific</option>
                    </select>
                  </div>
                  <div className="col-span-full md:col-span-1 md:flex md:items-end">
                    <button type="submit" disabled={requestLoading} className="generate-btn w-full md:w-auto">
                      {requestLoading ? "Sending..." : "Request"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          ) : null}

          {requestMessage ? (
            <div className="page-container">
              <p className="mt-4 font-ui text-[13px] text-[var(--ink-3)] text-center">{requestMessage}</p>
            </div>
          ) : null}

          {requestError ? (
            <div className="page-container">
              <p className="mt-4 font-ui text-[13px] text-[var(--accent-red)] text-center">{requestError}</p>
            </div>
          ) : null}
        </section>

        <section className="page-container mt-8">
          {loadError ? <p className="mb-6 font-ui text-[13px] text-[var(--accent-red)] text-center">{loadError}</p> : null}

          {loading ? null : filteredArticles.length > 0 ? (
            <div className="article-grid-container">
              <div className="article-grid">
                {filteredArticles.map((article, index) => (
                  <FeedCard key={`${article?.slug || article?.headline || "article"}`} article={article} priority={index === 0} />
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              {emptyMessage}
            </div>
          )}
        </section>
      </main>

      <SubscriptionWidget />

      <footer className="footer">
        <div className="footer-copy">ClearLens is a public news browsing site built around published reporting.</div>
        <div className="footer-copy">Search the feed, open a story, or request an article by email.</div>
        <div className="footer-legal">
          <div className="footer-legal-heading">Legal</div>
          <Link href="/legal" className="footer-legal-link">
            Legal Notice &amp; Editorial Standards
          </Link>
          <Link href="/about" className="footer-legal-link">
            About
          </Link>
        </div>
      </footer>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  );
}
