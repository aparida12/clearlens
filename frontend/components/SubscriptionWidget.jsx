"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";

const subscriptionSections = ["Health", "Science", "Policy", "Economy", "Technology", "Environment", "Law"];

function normalizeEmail(user) {
  return String(
    user?.primaryEmailAddress?.emailAddress ||
      user?.emailAddresses?.[0]?.emailAddress ||
      "",
  ).trim();
}

export default function SubscriptionWidget() {
  const { user } = useUser();
  const defaultEmail = useMemo(() => normalizeEmail(user), [user]);
  const [email, setEmail] = useState(defaultEmail);
  const [selectedSections, setSelectedSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setEmail(defaultEmail);
  }, [defaultEmail]);

  function toggleSection(section) {
    setSelectedSections((current) =>
      current.includes(section)
        ? current.filter((value) => value !== section)
        : [...current, section],
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          topics: [],
          sections: selectedSections.length > 0 ? selectedSections : ["all"],
        }),
      });
      await response.json();

      if (!response.ok) {
        throw new Error("Failed to subscribe.");
      }

      setMessage("You're subscribed.");
      setSelectedSections([]);
    } catch (err) {
      setError(String(err?.message || "Failed to subscribe."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="subscription-strip">
      <div className="app-shell subscription-shell">
        <div className="subscription-copy">
          <p className="subscription-title">Never miss a story.</p>
          <p className="subscription-subtitle">
            Get ClearLens articles delivered to your inbox when we publish in your areas of interest.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="subscription-form">
          <div className="subscription-row">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="Email address"
              className="subscription-input"
              aria-label="Email address"
            />
            <button type="submit" disabled={loading} className="subscription-button">
              {loading ? "Subscribing..." : "Subscribe"}
            </button>
          </div>

          <div className="subscription-pill-group" role="group" aria-label="Select subscription sections">
            {subscriptionSections.map((section) => {
              const active = selectedSections.includes(section);
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => toggleSection(section)}
                  className={`subscription-pill ${active ? "active" : ""}`}
                >
                  {section}
                </button>
              );
            })}
          </div>

          {message ? <p className="subscription-message">{message}</p> : null}
          {error ? <p className="subscription-error">{error}</p> : null}
        </form>
      </div>
    </section>
  );
}
