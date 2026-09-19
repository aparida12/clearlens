"use client";

import Link from "next/link";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

const sectionNavItems = ["All", "Health", "Politics", "Science", "Economy", "Technology", "Environment", "Law", "World", "Sports", "Entertainment"];

function formatToday() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export default function SiteHeader({
  activePage = "home",
  activeSection = "Health",
  onSectionChange,
  showSectionHomeLink = false,
  showSectionNav = true,
}) {
  const { isSignedIn } = useUser();
  const todayLabel = formatToday();

  return (
    <>
      <header className="top-strip">
        <div className="top-strip-left">
          <button type="button" className="top-strip-menu" aria-label="Open menu">Menu</button>
          <span className="divider">·</span>
          <Link href="/" className="top-strip-brand">CLEARLENS</Link>
        </div>

        <div className="top-strip-center">{todayLabel}</div>

        <div className="top-strip-right">
          <nav className="top-strip-links" aria-label="Site navigation">
            <Link href="/" className={`top-strip-link ${activePage === "home" ? "active" : ""}`}>Home</Link>
            <span className="top-strip-separator">·</span>
            <Link href="/legal" className={`top-strip-link ${activePage === "legal" ? "active" : ""}`}>Legal</Link>
            <span className="top-strip-separator">·</span>
            <Link href="/about" className={`top-strip-link ${activePage === "about" ? "active" : ""}`}>About</Link>
          </nav>
          {isSignedIn ? (
            <UserButton afterSignOutUrl="/" />
          ) : (
            <SignInButton mode="modal">
              <button type="button">Sign In</button>
            </SignInButton>
          )}
        </div>
      </header>

      <div className="masthead">
        <Link href="/" className="masthead-title">ClearLens</Link>
      </div>

      {showSectionNav ? (
        <nav className="section-nav">
          <div className="app-shell nav-shell">
            {showSectionHomeLink ? (
              <>
                <Link href="/" className="section-nav-item section-nav-home-item">
                  Home
                </Link>
                <span className="section-nav-divider" aria-hidden="true" />
              </>
            ) : null}

            {sectionNavItems.map((item) => {
              const active = activeSection === item;
              return (
                <button key={item} type="button" onClick={() => onSectionChange?.(item)} className={`section-nav-item ${active ? "active" : ""}`}>
                  {item}
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}
    </>
  );
}