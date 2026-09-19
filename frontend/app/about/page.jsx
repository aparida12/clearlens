"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";

export default function AboutPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState("Health");

  function handleSectionChange(item) {
    setActiveSection(item);
    router.push(`/?section=${item.toLowerCase()}`);
  }

  return (
    <div id="about" className="page-shell">
      <SiteHeader
        activePage="about"
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        showSectionHomeLink
      />

      <main className="about-page page-container">
        <div className="about-content">
          <section className="about-hero">
            <h1 className="about-title">About ClearLens</h1>
            <p className="about-subtitle">
              ClearLens is an AI transparency platform built on the belief that journalism should be evidence-based, structurally unbiased, and completely open about how it works.
            </p>
          </section>

          <section className="about-section">
            <h2 className="about-section-heading">What We Do</h2>
            <p className="about-body">
              ClearLens monitors thousands of news sources and research publications around the clock. When a topic reaches a threshold of credible coverage, our AI agent writes a complete, sourced article — then scores it for bias, confidence, and source quality before publishing. Every article on ClearLens is written by AI, labeled as such, and grounded in real, named sources.
            </p>
            <p className="about-body">
              We do not have a political agenda. We do not accept advertising. We do not employ opinion writers. Our only editorial standard is evidence.
            </p>
          </section>

          <section className="about-section">
            <h2 className="about-section-heading">How It Works</h2>
            <div className="about-how-grid">
              <article className="about-how-item">
                <div className="about-how-number">01</div>
                <h3 className="about-how-title">Source Monitoring</h3>
                <p className="about-how-description">Our agent continuously pulls from peer-reviewed journals, government agencies, and wire services to detect emerging stories worth covering.</p>
              </article>
              <article className="about-how-item">
                <div className="about-how-number">02</div>
                <h3 className="about-how-title">AI Authorship</h3>
                <p className="about-how-description">When a story meets our quality threshold, Claude writes a complete article — specific, sourced, and structurally neutral — in under 60 seconds.</p>
              </article>
              <article className="about-how-item">
                <div className="about-how-number">03</div>
                <h3 className="about-how-title">Transparency Scoring</h3>
                <p className="about-how-description">Every article receives a bias score, a confidence rating, and a full source list. You see exactly how the story was built.</p>
              </article>
            </div>
          </section>

          <section className="about-section">
            <h2 className="about-section-heading">Our Standards</h2>
            <div className="about-standards-grid">
              <div>
                <h3 className="about-standards-title about-standards-title-good">What we always do:</h3>
                <ul className="about-standards-list">
                  <li className="about-standards-item about-standards-item-good">Cite named, verifiable sources</li>
                  <li className="about-standards-item about-standards-item-good">Label every article as AI-generated</li>
                  <li className="about-standards-item about-standards-item-good">Publish a bias score with every story</li>
                  <li className="about-standards-item about-standards-item-good">Include a dissenting or cautionary perspective</li>
                  <li className="about-standards-item about-standards-item-good">Show word count and confidence level</li>
                </ul>
              </div>

              <div>
                <h3 className="about-standards-title about-standards-title-bad">What we never do:</h3>
                <ul className="about-standards-list">
                  <li className="about-standards-item about-standards-item-bad">Accept payment to cover a topic</li>
                  <li className="about-standards-item about-standards-item-bad">Publish opinion or editorial content</li>
                  <li className="about-standards-item about-standards-item-bad">Remove articles due to external pressure</li>
                  <li className="about-standards-item about-standards-item-bad">Use anonymous sources</li>
                  <li className="about-standards-item about-standards-item-bad">Editorialize or take political positions</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="about-section about-built-with">
            <p className="about-built-text">ClearLens is built on Claude by Anthropic · NewsAPI · GNews · Unsplash · Supabase · Next.js</p>
          </section>

          <section className="about-section about-contact">
            <p className="about-contact-question">Questions, corrections, or source disputes?</p>
            <p className="about-contact-email">Reach us at hello@clearlens.ai</p>
          </section>
        </div>
      </main>
    </div>
  );
}