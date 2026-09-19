"use client";

import { useEffect, useMemo, useState } from "react";
import ArticleView from "@/components/ArticleView";
import SiteHeader from "@/components/SiteHeader";

function defaultQuestionFromHeadline(headline) {
  const title = String(headline || "").trim();
  if (!title) return "What is the consensus on this story?";
  return `What is the consensus on: ${title}?`;
}

export default function StoryArticleClient({ article }) {
  const [activeSection, setActiveSection] = useState(String(article?.section || "Health"));
  const [pollData, setPollData] = useState(null);
  const [pollLoading, setPollLoading] = useState(false);

  const topic = useMemo(() => {
    return String(article?.topic || article?.headline || "").trim();
  }, [article]);

  const question = useMemo(() => defaultQuestionFromHeadline(article?.headline), [article?.headline]);

  useEffect(() => {
    let cancelled = false;

    async function loadPoll() {
      if (!topic || !question) return;

      setPollLoading(true);

      try {
        const response = await fetch("/api/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, question, sources: article?.sources || [] }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load poll.");
        }

        if (!cancelled) {
          if (payload?.poll) {
            setPollData(payload.poll);
          } else {
            setPollData(null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPollData(null);
        }
      } finally {
        if (!cancelled) {
          setPollLoading(false);
        }
      }
    }

    loadPoll();

    return () => {
      cancelled = true;
    };
  }, [topic, question, article?.sources]);

  return (
    <div className="page-shell">
      <SiteHeader activePage="home" activeSection={activeSection} onSectionChange={setActiveSection} />

      <main className="page-container page-section-pad">
        <ArticleView article={article} pollData={pollData} pollLoading={pollLoading} />
      </main>
    </div>
  );
}
