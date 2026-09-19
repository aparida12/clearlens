"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SiteHeader from "@/components/SiteHeader";

function normalizeArticles(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.articles)) return payload.articles;
  return [];
}

function getCardDate(article) {
  return String(article?.date || article?.createdAt || article?.generatedAt || article?.publishedAt || article?.created_at || "").trim();
}

function getHeadline(article) {
  return String(article?.headline || article?.title || "Untitled").trim() || "Untitled";
}

function getSection(article) {
  return String(article?.section || article?.category || "News").trim() || "News";
}

function getExcerpt(article) {
  const subheadline = String(article?.subheadline || article?.summary || article?.deck || "").trim();
  if (subheadline) return subheadline;
  const body = String(article?.body || article?.content || "").trim();
  if (!body) return "";
  return body.split(/\n\s*\n/)[0].trim().slice(0, 180);
}

function LiveFeedCard({ article }) {
  const headline = getHeadline(article);
  const section = getSection(article);
  const date = getCardDate(article);
  const excerpt = getExcerpt(article);
  const slug = String(article?.slug || "").trim();
  const href = slug ? `/story/${slug}` : "/";

  return (
    <Link href={href} className="article-card card-body section-accent-default" aria-label={`Open story: ${headline}`}>
      <div className="card-section">{section}</div>
      <h3 className="card-headline headline-size-md">{headline}</h3>
      {excerpt ? <p className="card-deck">{excerpt}</p> : null}
      <div className="card-byline">
        <span>{String(article?.status || "published")}</span>
        <span>{date}</span>
      </div>
    </Link>
  );
}

export default function AdminPage() {
  const [liveArticles, setLiveArticles] = useState([]);
  const [agentStatus, setAgentStatus] = useState({ status: "idle", lastRun: null });
  const [reviewArticles, setReviewArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState("");
  const [feedError, setFeedError] = useState("");
  const [runLoading, setRunLoading] = useState(false);
  const [runMode, setRunMode] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestMessage, setDigestMessage] = useState("");
  const [agentLogs, setAgentLogs] = useState([]);
  const [runSummary, setRunSummary] = useState(null);

  useEffect(() => {
    if (!runLoading) return undefined;

    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/agent/status", { cache: "no-store" });
        const payload = await response.json();
        setAgentStatus(payload || { status: "idle", lastRun: null });

        const step = String(payload?.currentStep || "").trim();
        if (step) {
          setAgentLogs((current) => {
            if (current[current.length - 1] === step) return current;
            return [...current, step];
          });
        }
      } catch {
        // Polling is best-effort while a run is active.
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runLoading]);

  async function loadLiveFeed() {
    setFeedLoading(true);
    setFeedError("");

    try {
      const [articlesResponse, statusResponse] = await Promise.all([
        fetch("/api/agent/articles?limit=24", { cache: "no-store" }),
        fetch("/api/agent/status", { cache: "no-store" }),
      ]);

      const articlesPayload = await articlesResponse.json();
      const statusPayload = await statusResponse.json();

      setLiveArticles(normalizeArticles(articlesPayload));
      setAgentStatus(statusPayload || { status: "idle", lastRun: null });
    } catch (err) {
      setFeedError(String(err?.message || "Failed to load live feed."));
      setLiveArticles([]);
    } finally {
      setFeedLoading(false);
    }
  }

  async function loadReviewQueue() {
    setReviewLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/articles", { cache: "no-store" });
      const payload = await response.json();
      setReviewArticles(normalizeArticles(payload));
    } catch (err) {
      setError(String(err?.message || "Failed to load review queue."));
      setReviewArticles([]);
    } finally {
      setReviewLoading(false);
    }
  }

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadLiveFeed(), loadReviewQueue()]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function updateStatus(id, status) {
    try {
      const response = await fetch("/api/admin/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update article status.");
      }
      setReviewArticles((current) => current.map((article) => (article.id === id ? { ...article, status } : article)));
    } catch (err) {
      setError(String(err?.message || "Failed to update article status."));
    }
  }

  async function runAgentNow({ test }) {
    if (!test) {
      const confirmed = window.confirm("This will publish articles live. Are you sure?");
      if (!confirmed) return;
    }

    setRunLoading(true);
    setRunMode(test ? "test" : "real");
    setRunSummary(null);
    setAgentLogs([test ? "START: Test run started" : "START: Real run started"]);
    setFeedError("");

    try {
      const endpoint = test ? "/api/agent/run?test=true" : "/api/agent/run";
      const response = await fetch(endpoint, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || "Failed to run agent.");
      }

      if (Array.isArray(payload?.log)) {
        setAgentLogs(payload.log.map((entry) => `${entry.step}: ${entry.message}`));
      }
      setRunSummary(payload);
      await loadLiveFeed();
    } catch (err) {
      setFeedError(String(err?.message || "Failed to run agent."));
    } finally {
      setRunLoading(false);
      setRunMode(null);
    }
  }

  function scoreClass(score) {
    const value = Number(score || 0);
    if (value >= 8) return "text-[var(--accent-green)]";
    if (value >= 6) return "text-[#b7791f]";
    return "text-[var(--accent-red)]";
  }

  function decisionClass(decision) {
    const value = String(decision || "").toLowerCase();
    if (value === "publish") return "text-[var(--accent-green)] border-[var(--accent-green)]";
    if (value === "pending") return "text-[#b7791f] border-[#b7791f]";
    return "text-[var(--accent-red)] border-[var(--accent-red)]";
  }

  async function sendDigestNow() {
    setDigestLoading(true);
    setDigestMessage("");
    setFeedError("");

    try {
      const response = await fetch("/api/email/digest", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || "Failed to send digest.");
      }
      setDigestMessage(`Digest sent: ${payload.sent} · skipped: ${payload.skipped}`);
    } catch (err) {
      setFeedError(String(err?.message || "Failed to send digest."));
    } finally {
      setDigestLoading(false);
    }
  }

  async function resetAllArticles() {
    const confirmed = window.confirm("This will delete all articles. Are you sure?");
    if (!confirmed) return;

    setResetLoading(true);
    setFeedError("");

    try {
      const response = await fetch("/api/agent/reset", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || "Failed to reset all articles.");
      }
      await loadDashboard();
    } catch (err) {
      setFeedError(String(err?.message || "Failed to reset all articles."));
    } finally {
      setResetLoading(false);
    }
  }

  const pending = reviewArticles.filter((article) => String(article?.status || "").toLowerCase() === "pending");
  const reviewed = reviewArticles.filter((article) => String(article?.status || "").toLowerCase() !== "pending");

  return (
    <div className="page-shell">
      <SiteHeader activePage="home" />

      <main className="app-shell pb-16">
        <section className="pt-8">
          <div className="paper-panel paper-panel-controls">
            <div>
              <p className="font-ui text-[11px] uppercase tracking-[0.22em] text-[var(--ink-4)]">Admin dashboard</p>
              <h1 className="mt-2 font-display text-[34px] leading-[1.05] text-[var(--ink)]">Live Feed</h1>
              <p className="mt-3 max-w-2xl font-body text-[16px] leading-[1.7] text-[var(--ink-3)]">
                Internal view of the published feed, the agent run controls, and the review queue.
              </p>
            </div>
            <div className="paper-panel-actions">
              <button type="button" onClick={() => runAgentNow({ test: false })} disabled={runLoading} className="generate-btn feed-button-narrow">
                {runLoading ? "Running..." : "Run Agent Now"}
              </button>
              <button type="button" onClick={sendDigestNow} disabled={digestLoading} className="generate-btn feed-button-narrow">
                {digestLoading ? "Sending..." : "Send Digest Now"}
              </button>
              <button type="button" onClick={resetAllArticles} disabled={resetLoading} className="generate-btn feed-button-dark">
                {resetLoading ? "Resetting..." : "Reset All Articles"}
              </button>
            </div>
          </div>

          <div className="mt-4 font-ui text-[13px] text-[var(--ink-4)]">
            Agent status: {agentStatus?.status || "idle"} · Last run: {agentStatus?.lastRun || "never"}
          </div>
          {digestMessage ? <p className="mt-4 font-ui text-[13px] text-[var(--ink-3)]">{digestMessage}</p> : null}

          {feedError ? <p className="mt-4 font-ui text-[13px] text-[var(--accent-red)]">{feedError}</p> : null}
          {error ? <p className="mt-4 font-ui text-[13px] text-[var(--accent-red)]">{error}</p> : null}
        </section>

        <section className="mt-10">
          <div className="paper-panel paper-panel-form">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-[24px] leading-[1.1] text-[var(--ink)]">Manual test mode</h2>
                <p className="mt-2 font-ui text-[13px] text-[var(--ink-4)]">Run the full agent pipeline in dry-run mode before publishing live.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => runAgentNow({ test: true })}
                  disabled={runLoading}
                  className="generate-btn feed-button-narrow"
                >
                  {runLoading && runMode === "test" ? "Running..." : "Run Test (no publish)"}
                </button>
                <button
                  type="button"
                  onClick={() => runAgentNow({ test: false })}
                  disabled={runLoading}
                  className="generate-btn feed-button-dark"
                >
                  {runLoading && runMode === "real" ? "Running..." : "Run Real (publishes)"}
                </button>
              </div>
            </div>

            <div className="paper-panel p-4">
              <div className="font-ui text-[11px] uppercase tracking-[0.16em] text-[var(--ink-4)]">Live log feed</div>
              <div className="mt-3 max-h-52 overflow-y-auto font-ui text-[12px] leading-[1.6] text-[var(--ink-3)]">
                {agentLogs.length ? (
                  agentLogs.map((line, index) => (
                    <div key={`${line}-${index}`}>{line}</div>
                  ))
                ) : (
                  <div>No active run.</div>
                )}
              </div>
            </div>

            {runSummary ? (
              <div className="mt-6">
                <div className="overflow-x-auto border border-[var(--rule)]">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[var(--rule)] bg-[#faf9f7] font-ui text-[11px] uppercase tracking-[0.14em] text-[var(--ink-4)]">
                        <th className="px-3 py-2">Topic</th>
                        <th className="px-3 py-2">Headline</th>
                        <th className="px-3 py-2">Score</th>
                        <th className="px-3 py-2">Decision</th>
                        <th className="px-3 py-2">Issues</th>
                        <th className="px-3 py-2">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(runSummary.articles) ? runSummary.articles : []).map((row, index) => (
                        <tr key={`${row.topic || "topic"}-${index}`} className="border-b border-[var(--rule)] align-top font-body text-[13px] text-[var(--ink-2)] last:border-0">
                          <td className="px-3 py-3">{row.topic || "-"}</td>
                          <td className="px-3 py-3">{row.headline || "-"}</td>
                          <td className={`px-3 py-3 font-ui text-[12px] ${scoreClass(row.score)}`}>{Number.isFinite(Number(row.score)) ? row.score : "-"}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-block border px-2 py-[2px] font-ui text-[10px] uppercase tracking-[0.14em] ${decisionClass(row.decision)}`}>
                              {String(row.decision || row.status || "unknown").toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-3">{Array.isArray(row.issues) && row.issues.length ? row.issues.join(", ") : "-"}</td>
                          <td className="px-3 py-3">{String(row.preview || "-").slice(0, 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 grid gap-2 font-ui text-[12px] text-[var(--ink-3)] md:grid-cols-3">
                  <div>Total duration: {Number(runSummary.duration_ms || 0)}ms</div>
                  <div>Headlines fetched: {Number(runSummary.headlines_fetched || 0)}</div>
                  <div>Topics selected: {Number(runSummary.topics_selected || 0)}</div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-[24px] leading-[1.1] text-[var(--ink)]">Live feed</h2>
              <p className="mt-2 font-ui text-[13px] text-[var(--ink-4)]">Published stories available to the public feed.</p>
            </div>
            <button type="button" onClick={loadLiveFeed} className="generate-btn">
              Refresh
            </button>
          </div>

          {loading || feedLoading ? null : liveArticles.length > 0 ? (
            <div className="article-grid-container">
              <div className="article-grid">
                {liveArticles.map((article, index) => (
                  <LiveFeedCard key={`${article?.slug || article?.headline || "live"}-${index}`} article={article} />
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              No live articles yet. Run the agent or wait for the next scheduled cycle.
            </div>
          )}
        </section>

        <section className="mt-12">
          <div className="mb-4">
            <h2 className="font-display text-[24px] leading-[1.1] text-[var(--ink)]">Review queue</h2>
            <p className="mt-2 font-ui text-[13px] text-[var(--ink-4)]">Approve or reject uploaded items before they reach the feed.</p>
          </div>

          {reviewLoading ? null : pending.length === 0 ? (
            <div className="empty-state">
              All caught up. No pending articles.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {pending.map((article) => (
                <div key={article.id} className="paper-panel paper-panel-form">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-display text-[22px] leading-[1.2] text-[var(--ink)]">{article.title}</h3>
                      <div className="mt-2 font-ui text-[12px] text-[var(--ink-4)]">
                        {article.source} · {article.article_date || article.created_at}
                      </div>
                    </div>
                    <span className="border border-[var(--rule)] px-2 py-[2px] font-ui text-[10px] uppercase tracking-[0.16em] text-[var(--ink-3)]">Pending</span>
                  </div>

                  <p className="mt-4 max-w-4xl font-body text-[15px] leading-[1.75] text-[var(--ink-3)] line-clamp-3">
                    {(article.content || "").slice(0, 300)}...
                  </p>

                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() => setExpanded(expanded === article.id ? null : article.id)}
                      className="font-ui text-[12px] uppercase tracking-[0.14em] text-[var(--ink-4)] underline underline-offset-2"
                    >
                      {expanded === article.id ? "Hide full article" : "Read full article"}
                    </button>
                    <div className="ml-auto flex gap-2">
                      <button
                        onClick={() => updateStatus(article.id, "rejected")}
                        className="border border-[var(--rule)] px-4 py-2 font-ui text-[11px] uppercase tracking-[0.14em] text-[var(--ink-3)] transition-colors hover:border-[var(--accent-red)] hover:text-[var(--accent-red)]"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => updateStatus(article.id, "approved")}
                        className="generate-btn"
                      >
                        Approve
                      </button>
                    </div>
                  </div>

                  {expanded === article.id ? (
                    <div className="mt-6 border-t border-[var(--rule)] pt-6 font-body text-[15px] leading-[1.8] text-[var(--ink-2)] whitespace-pre-wrap">
                      {article.content}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {reviewLoading ? <p className="mt-4 font-ui text-[13px] text-[var(--ink-4)]">Loading review queue...</p> : null}

          {reviewed.length > 0 ? (
            <div className="mt-10">
              <h3 className="font-ui text-[11px] uppercase tracking-[0.22em] text-[var(--ink-4)]">Reviewed ({reviewed.length})</h3>
              <div className="mt-4 flex flex-col gap-3">
                {reviewed.map((article) => (
                  <div key={article.id} className="paper-panel flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[18px] leading-[1.25] text-[var(--ink)] line-clamp-1">{article.title}</div>
                      <div className="mt-1 font-ui text-[12px] text-[var(--ink-4)]">{article.source}</div>
                    </div>
                    <span className={`border px-2 py-[2px] font-ui text-[10px] uppercase tracking-[0.16em] ${article.status === "approved" ? "border-[var(--accent-green)] text-[var(--accent-green)]" : "border-[var(--accent-red)] text-[var(--accent-red)]"}`}>
                      {article.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
