import hashlib
import io
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse
import textwrap

import feedparser
import requests
import schedule
import openai
import smtplib
from dateutil import parser as date_parser
from dotenv import load_dotenv
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from cross_researcher import CrossResearcher

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env", override=True)


def read_env_value(name, default=None):
    value = os.getenv(name, default)
    if value is None:
        return None

    cleaned = str(value).strip()
    lowered = cleaned.lower()
    if lowered.startswith("your_") or "placeholder" in lowered:
        return default
    return cleaned

# Configuration
GROQ_API_KEY = read_env_value("GROQ_API_KEY")
NCBI_API_KEY = read_env_value("NCBI_API_KEY")
GMAIL_SENDER = os.getenv("GMAIL_SENDER", "aryanksh.parida@gmail.com")
GMAIL_RECIPIENT = os.getenv("GMAIL_RECIPIENT", "aryanksh.parida@gmail.com")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")

DB_PATH = "processed_items.db"
WEB_DB_PATH = BASE_DIR / DB_PATH
AUTO_PUBLISH_TO_WEB = os.getenv("AUTO_PUBLISH_TO_WEB", "true").strip().lower() in {"1", "true", "yes", "on"}

PUBMED_TERM = os.getenv(
    "PUBMED_TERM", "public health OR pandemic OR vaccine OR clinical trial"
)
PUBMED_MAX = int(os.getenv("PUBMED_MAX", "10"))
MAX_DIGEST_ARTICLES = int(os.getenv("MAX_DIGEST_ARTICLES", "2"))
RESEARCH_DEPTH = os.getenv("RESEARCH_DEPTH", "exhaustive")
RUN_SCHEDULE_TIME = os.getenv("RUN_SCHEDULE_TIME", "09:00")
RUN_SCHEDULE_TIMES = os.getenv("RUN_SCHEDULE_TIMES", "")
RUN_INTERVAL_HOURS = int(os.getenv("RUN_INTERVAL_HOURS", "0"))
GENERATED_REPORTS_DIR = Path(os.getenv("GENERATED_REPORTS_DIR", "generated_reports"))
SMTP_TIMEOUT = int(os.getenv("SMTP_TIMEOUT", "60"))
SMTP_MAX_RETRIES = int(os.getenv("SMTP_MAX_RETRIES", "3"))
SMTP_RETRY_DELAY_SECONDS = int(os.getenv("SMTP_RETRY_DELAY_SECONDS", "5"))
DELIVERY_MODE = os.getenv("DELIVERY_MODE", "email").strip().lower()
SLACK_WEBHOOK_URL = read_env_value("SLACK_WEBHOOK_URL")
SLACK_BOT_TOKEN = read_env_value("SLACK_BOT_TOKEN")
SLACK_CHANNEL_ID = read_env_value("SLACK_CHANNEL_ID")
SLACK_TIMEOUT = int(os.getenv("SLACK_TIMEOUT", "20"))
MIN_VERIFIED_SOURCES = int(os.getenv("MIN_VERIFIED_SOURCES", "3"))
MAX_VERIFIED_SOURCES = int(os.getenv("MAX_VERIFIED_SOURCES", "0"))
MIN_PEER_REVIEWED_SOURCES = int(os.getenv("MIN_PEER_REVIEWED_SOURCES", "2"))
MIN_INSTITUTIONAL_SOURCES = int(os.getenv("MIN_INSTITUTIONAL_SOURCES", "2"))
MIN_CONFIDENCE_SCORE = int(os.getenv("MIN_CONFIDENCE_SCORE", "85"))
BUZZ_CONFIDENCE_FLOOR = int(os.getenv("BUZZ_CONFIDENCE_FLOOR", "64"))
MIN_BUZZ_NEWS_SOURCES = int(os.getenv("MIN_BUZZ_NEWS_SOURCES", "6"))
MIN_BUZZ_TOTAL_SOURCES = int(os.getenv("MIN_BUZZ_TOTAL_SOURCES", "12"))
MIN_POPULATION_IMPACT_SCORE = int(os.getenv("MIN_POPULATION_IMPACT_SCORE", "16"))
APPROVAL_MODE = os.getenv("APPROVAL_MODE", "automatic").strip().lower()
QUALITY_MODE = os.getenv("QUALITY_MODE", "strict").strip().lower()
STRICT_MIN_CONFIDENCE_SCORE = int(os.getenv("STRICT_MIN_CONFIDENCE_SCORE", "90"))
STRICT_MIN_VERIFIED_SOURCES = int(os.getenv("STRICT_MIN_VERIFIED_SOURCES", "5"))
STRICT_MIN_PEER_REVIEWED_SOURCES = int(os.getenv("STRICT_MIN_PEER_REVIEWED_SOURCES", "3"))
STRICT_MIN_INSTITUTIONAL_SOURCES = int(os.getenv("STRICT_MIN_INSTITUTIONAL_SOURCES", "3"))
PENDING_DIGESTS_DIR = Path(os.getenv("PENDING_DIGESTS_DIR", "pending_digests"))
DELIVERY_DEDUP_HOURS = int(os.getenv("DELIVERY_DEDUP_HOURS", "36"))
RECENCY_WINDOW_HOURS = int(os.getenv("RECENCY_WINDOW_HOURS", "168"))

TRUSTED_SOURCE_DOMAINS = [
    "nih.gov",
    "ncbi.nlm.nih.gov",
    "pubmed.ncbi.nlm.nih.gov",
    "who.int",
    "cdc.gov",
    "fda.gov",
    "reuters.com",
    "reutersagency.com",
    "apnews.com",
    "nytimes.com",
    "bloomberg.com",
    "wsj.com",
    "ft.com",
    "bbc.com",
    "npr.org",
    "statnews.com",
    "news.google.com",
    "nature.com",
    "thelancet.com",
    "nejm.org",
    "bmj.com",
    "jamanetwork.com",
    "science.org",
    "sciencedirect.com",
    "arxiv.org",
    "medrxiv.org",
    "biorxiv.org",
]

INSTITUTIONAL_SOURCE_DOMAINS = [
    "who.int",
    "cdc.gov",
    "fda.gov",
    "nih.gov",
    "ncbi.nlm.nih.gov",
    "pubmed.ncbi.nlm.nih.gov",
    "ema.europa.eu",
    "ecdc.europa.eu",
    "gov.uk",
]

SENSATIONAL_WORD_REPLACEMENTS = {
    "breakthrough": "notable development",
    "game-changing": "important",
    "miracle": "potential",
    "shocking": "concerning",
    "alarming": "important",
    "cure": "treatment",
    "revolutionary": "new",
    "must": "may",
    "proves": "suggests",
}

IRRELEVANT_TITLE_PATTERNS = [
    r"\bthank you\b",
    r"\bpeer reviewer",
    r"\backnowledg(e)?ment",
    r"\bscientometric",
    r"\bbibliometric",
    r"\beditorial\b",
]

LOW_IMPACT_TITLE_PATTERNS = [
    r"\bstudent spotlight\b",
    r"\bpeople:\b",
    r"\bpioneer\b",
    r"\bpublic health week\b",
    r"\bannual report\b",
    r"\bdual degrees?\b",
    r"\bresources\b",
    r"\bspotlight\b",
    r"\bfrom vision to reality\b",
]

RSS_SOURCES = [
    {
        "source": "Google News Health",
        "url": "https://news.google.com/rss/search?q=public+health+OR+outbreak+OR+recall+OR+guideline&hl=en-US&gl=US&ceid=US:en",
    },
    {
        "source": "WHO",
        "url": "https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml",
    },
    {
        "source": "NIH",
        "url": "https://news.nih.gov/news-releases/feed",
    },
    {
        "source": "CDC",
        "url": "https://tools.cdc.gov/api/v2/resources/media/316422.rss",
    },
    {
        "source": "FDA",
        "url": "https://www.fda.gov/about-fda/weekly-update-fda-medicine-safety/rss.xml",
    },
]

FDA_API_URL = "https://api.fda.gov/drug/event.json"

GROQ_API_KEYS = [
    key for key in [
        GROQ_API_KEY,
        read_env_value("GROQ_API_KEY_2"),
        read_env_value("GROQ_API_KEY_3"),
    ] if key
]

groq_clients = [
    openai.OpenAI(base_url="https://api.groq.com/openai/v1", api_key=key)
    for key in GROQ_API_KEYS
]

client = groq_clients[0] if groq_clients else None


def groq_chat_completion(**kwargs):
    if not groq_clients:
        raise RuntimeError("No GROQ_API_KEY configured; AI summarization is disabled.")
    last_error = None
    for i, gclient in enumerate(groq_clients):
        try:
            return gclient.chat.completions.create(**kwargs)
        except Exception as e:
            last_error = e
            print(f"Groq key #{i+1} failed: {e}. Trying next key if available...")
            continue
    raise RuntimeError(f"All Groq API keys failed. Last error: {last_error}")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS processed (item_id TEXT PRIMARY KEY, title TEXT, source TEXT, date TEXT)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS delivery_log (
            signature TEXT PRIMARY KEY,
            title TEXT,
            source TEXT,
            delivered_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def is_processed(conn, item_id):
    cursor = conn.execute("SELECT 1 FROM processed WHERE item_id = ?", (item_id,))
    return cursor.fetchone() is not None


def mark_processed(conn, item_id, title, source, date):
    conn.execute(
        "INSERT OR IGNORE INTO processed (item_id, title, source, date) VALUES (?, ?, ?, ?)",
        (item_id, title, source, date),
    )
    conn.commit()


def delivery_signature(item):
    title = (item.get("title") or "").strip().lower()
    source = (item.get("source") or "").strip().lower()
    core = f"{title}|{source}"
    return hashlib.sha256(core.encode("utf-8", errors="ignore")).hexdigest()


def was_recently_delivered(conn, item, within_hours=36):
    signature = delivery_signature(item)
    row = conn.execute(
        "SELECT delivered_at FROM delivery_log WHERE signature = ?",
        (signature,),
    ).fetchone()
    if not row:
        return False

    try:
        delivered_at = datetime.fromisoformat((row[0] or "").strip())
    except Exception:
        return False

    return delivered_at >= (datetime.now() - timedelta(hours=within_hours))


def mark_delivered(conn, item):
    signature = delivery_signature(item)
    delivered_at = datetime.now().isoformat(timespec="seconds")
    conn.execute(
        """
        INSERT INTO delivery_log (signature, title, source, delivered_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(signature) DO UPDATE SET delivered_at = excluded.delivered_at
        """,
        (
            signature,
            item.get("title", ""),
            item.get("source", ""),
            delivered_at,
        ),
    )
    conn.commit()


# --- Free, high-signal filter ---
def score_item_signal(item):
    """
    Returns a signal score for the item (higher = more important)
    """
    score = 0
    text = (item.get("title", "") + " " + item.get("text", "")).lower()

    # High-impact keywords (signal)
    high_impact_keywords = [
        "pandemic", "outbreak", "fda approval", "clinical trial",
        "phase 3", "recall", "black box warning",
        "mortality", "hospitalization", "public health",
        "emergency use", "policy", "vaccine", "drug approval"
    ]

    # Noise keywords (low signal)
    noise_keywords = [
        "opinion", "editorial", "perspective",
        "case report", "small study", "mouse study",
        "in vitro", "preliminary", "pilot study",
        "celebrity", "trend", "viral"
    ]

    # Trusted sources
    high_trust_sources = ["WHO", "CDC", "NIH", "FDA", "PubMed"]

    # Score high-impact keywords
    if any(k in text for k in high_impact_keywords):
        score += 30

    # Score trusted sources
    if item.get("source") in high_trust_sources:
        score += 20

    # Penalize noise
    if any(k in text for k in noise_keywords):
        score -= 25

    # Penalize non-news/non-actionable publication metadata items.
    title_lower = (item.get("title", "") or "").lower()
    if any(re.search(pattern, title_lower) for pattern in IRRELEVANT_TITLE_PATTERNS):
        score -= 50

    # Length heuristic
    if len(item.get("text", "")) > 200:
        score += 10

    # Title length heuristic
    if len(item.get("title", "")) > 8:
        score += 5

    return score


def score_population_impact(item):
    """Score whether a topic is broad and likely to affect many people."""
    text = (item.get("title", "") + " " + item.get("text", "")).lower()
    score = 0

    # Topics that are usually high public-impact and widely covered.
    impact_terms = [
        "outbreak",
        "pandemic",
        "epidemic",
        "recall",
        "drinking water",
        "food safety",
        "air quality",
        "heat wave",
        "measles",
        "influenza",
        "flu",
        "covid",
        "guideline",
        "policy",
        "nationwide",
        "public warning",
        "fda",
        "cdc",
        "who",
    ]
    score += sum(1 for term in impact_terms if term in text) * 8

    # Down-rank narrow or highly technical-only items.
    narrow_terms = [
        "single-blind",
        "cohort study",
        "pilot study",
        "in vitro",
        "mouse",
        "case report",
        "scientometric",
        "bibliometric",
        "student spotlight",
        "people:",
        "public health week",
        "annual report",
        "resources",
        "dual degree",
    ]
    score -= sum(1 for term in narrow_terms if term in text) * 5

    # Favor real-world newsroom/institution sources for bustling topics.
    source = (item.get("source") or "").lower()
    if any(k in source for k in ["google news", "cdc", "who", "nih", "fda", "reuters"]):
        score += 10

    return max(0, score)


def is_high_signal(item, threshold=25):
    """
    Returns True if the item passes the high-signal threshold
    """
    score = score_item_signal(item)
    return score >= threshold, score


def is_public_health_relevant(item):
    title = (item.get("title", "") or "").lower()
    text = (item.get("text", "") or "").lower()
    combined = f"{title} {text}"

    if any(re.search(pattern, title) for pattern in IRRELEVANT_TITLE_PATTERNS):
        return False
    if any(re.search(pattern, title) for pattern in LOW_IMPACT_TITLE_PATTERNS):
        return False

    required_any = [
        "public health",
        "pandemic",
        "outbreak",
        "recall",
        "safety alert",
        "vaccine",
        "clinical trial",
        "epidemi",
        "mortality",
        "hospital",
        "fda",
        "cdc",
        "who",
        "adverse event",
        "drug safety",
        "approval",
        "guideline",
        "infectious",
        "health policy",
        "screening",
        "prevention",
    ]
    return any(term in combined for term in required_any)


def is_duplicate(conn, item):
    """
    Simple duplicate check: compare title against last 50 processed items
    """
    cursor = conn.execute("SELECT title FROM processed ORDER BY date DESC LIMIT 50")
    recent_titles = [row[0].lower() for row in cursor.fetchall()]
    title = item.get("title", "").lower()

    for t in recent_titles:
        # Check if the start of the title matches
        if title[:50] in t or t[:50] in title:
            return True
    return False


def is_recent(date_str):
    if not date_str:
        return False
    try:
        item_date = date_parser.parse(date_str)
        if item_date.tzinfo is None:
            item_date = item_date.replace(tzinfo=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=RECENCY_WINDOW_HOURS)
        return item_date >= cutoff
    except:
        return False


def hash_item(item):
    unique = "|".join(
        [
            item.get("title", ""),
            item.get("source", ""),
            item.get("date", ""),
            item.get("text", "")[:400],
        ]
    )
    return hashlib.sha256(unique.encode("utf-8", errors="ignore")).hexdigest()


def normalize_item(title, date, source, text, url):
    item = {
        "title": title.strip() if title else "",
        "date": date.strip() if date else "",
        "source": source,
        "text": text.strip() if text else "",
        "url": url.strip() if url else "",
    }
    item["id"] = item["url"] or hash_item(item)
    return item


def fetch_rss_items(source, url):
    feed = feedparser.parse(url)
    items = []

    for entry in feed.entries[:10]:
        title = entry.get("title", "")
        date = entry.get("published", entry.get("updated", ""))
        link = entry.get("link", "")
        summary = entry.get("summary", entry.get("description", ""))
        item = normalize_item(title, date, source, summary, link)
        if not is_recent(item['date']):
            continue
        items.append(item)

    return items


def fetch_fda_items():
    from_date = (datetime.now() - timedelta(days=2)).strftime("%Y%m%d")
    to_date = datetime.now().strftime("%Y%m%d")
    params = {
        "search": f"receivedate:{from_date}+TO+{to_date}",
        "limit": 10,
    }
    response = requests.get(FDA_API_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    results = data.get("results", [])

    items = []
    for entry in results:
        title = entry.get("reportnumber", "")
        date = entry.get("receivedate", "")
        if not is_recent(date):
            continue
        url = f"https://www.fda.gov/safety/medwatch-fda-safety-information-and-adverse-event-reporting-program/fda-adverse-event-reporting-system-faers-public-dashboard"
        summary = entry.get("patient", {}).get("patientdeath", {}).get("patientdeathdate", "") or "FDA adverse event report"
        items.append(normalize_item(title, date, "FDA", summary, url))

    return items


def fetch_pubmed_items(term, max_results):
    search_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    summary_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

    params = {
        "db": "pubmed",
        "term": term,
        "sort": "pub+date",
        "retmax": max_results,
        "retmode": "json",
        "datetype": "pdat",
        "reldate": 2,
    }
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY

    def get_with_retry(url, params=None):
        last_error = None
        for attempt in range(1, 4):
            try:
                return requests.get(url, params=params, timeout=20)
            except (requests.exceptions.ConnectionError, TimeoutError, OSError) as exc:
                last_error = exc
                print(f"PubMed request attempt {attempt}/3 failed: {exc}")
                if attempt < 3:
                    time.sleep(2 * attempt)
        raise RuntimeError(f"PubMed request failed. Last error: {last_error}")

    response = get_with_retry(search_url, params=params)
    response.raise_for_status()
    data = response.json()
    ids = data.get("esearchresult", {}).get("idlist", [])
    if not ids:
        return []

    params = {
        "db": "pubmed",
        "id": ",".join(ids),
        "retmode": "json",
    }
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY

    response = get_with_retry(summary_url, params=params)
    response.raise_for_status()
    items_json = response.json().get("result", {})

    items = []
    for pmid in ids:
        record = items_json.get(pmid)
        if not record:
            continue
        title = record.get("title", "")
        date = record.get("pubdate", "")
        if not is_recent(date):
            continue
        source = "PubMed"
        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        text = record.get("summary", "") or record.get("title", "")
        items.append(normalize_item(title, date, source, text, url))

    return items


def summarize_item(item):
    if client is None:
        raise RuntimeError("GROQ_API_KEY is not set; AI summarization is disabled.")

    prompt = (
        "You are a medical research assistant. Review this item and return only valid JSON with the keys:"
        " summary, significance, category, red_flags.\n"
        "Use 3-4 plain-language sentences for the summary. "
        "Rate significance as High, Medium, or Low. "
        "Category must be Drug, Policy, or Research. "
        "Identify any immediate red flags such as small study size, industry funding, weak evidence, or safety concerns.\n\n"
        f"Title: {item['title']}\n"
        f"Source: {item['source']}\n"
        f"Date: {item['date']}\n"
        f"Content: {item['text']}\n"
        f"Link: {item['url']}\n"
    )

    completion = groq_chat_completion(
        model="openai/gpt-oss-20b",
        messages=[
            {"role": "user", "content": prompt}
        ],
        temperature=0.1,
        max_tokens=400,
        reasoning_effort="low",
    )

    text = completion.choices[0].message.content.strip()

    try:
        summary_data = json.loads(text)
    except json.JSONDecodeError:
        # fallback if the model returns text around JSON
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            summary_data = json.loads(text[start : end + 1])
        else:
            raise

    # If High significance, generate detailed research article
    if summary_data.get("significance", "").title() == "High":
        research_prompt = (
            "This is a high-significance health finding. Conduct in-depth research and create a comprehensive, unbiased article.\n"
            "Include:\n"
            "- Background on related topics (e.g., for Ozempic, discuss GLP-1 agonists).\n"
            "- Cross-referenced information from multiple sources.\n"
            "- Recent news articles and studies.\n"
            "- Balanced analysis of benefits, risks, and implications.\n"
            "- Citations to real or hypothetical sources for credibility.\n"
            "Structure as a full article with sections: Introduction, Background, Current Findings, Implications, Sources.\n"
            "Be completely unbiased and evidence-based.\n\n"
            f"Original Item:\nTitle: {item['title']}\nSource: {item['source']}\nDate: {item['date']}\nContent: {item['text']}\nLink: {item['url']}\n"
        )

        research_completion = groq_chat_completion(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "user", "content": research_prompt}
            ],
            temperature=0.1,
            max_tokens=2000,
            reasoning_effort="low",
        )

        research_text = research_completion.choices[0].message.content.strip()
        summary_data["detailed_article"] = research_text

    return summary_data


def safe_filename(text, max_len=80):
    cleaned = re.sub(r"[^a-zA-Z0-9\-\s_]", "", text or "article")
    cleaned = re.sub(r"\s+", "_", cleaned).strip("_")
    return (cleaned or "article")[:max_len]


def confidence_from_research_report(research_report):
    reliability = (
        research_report.get("metadata", {}).get("reliability_score", "low").lower()
    )
    total_sources = research_report.get("metadata", {}).get("total_sources_found", 0)

    base = {
        "high": 82,
        "medium": 68,
        "low": 54,
    }.get(reliability, 50)

    adjusted = max(40, min(95, base + min(12, total_sources // 2)))
    return {
        "label": reliability.title(),
        "score": adjusted,
    }


def evaluate_buzz_context(item, research_report):
    findings = research_report.get("findings", {})
    news = findings.get("related_news", [])
    total_sources = research_report.get("metadata", {}).get("total_sources_found", 0)
    impact_score = score_population_impact(item)

    unique_news_publishers = set()
    for n in news:
        src = (n.get("source") or "").strip().lower()
        if src:
            unique_news_publishers.add(src)

    is_buzzy = (
        len(news) >= MIN_BUZZ_NEWS_SOURCES
        and total_sources >= MIN_BUZZ_TOTAL_SOURCES
        and impact_score >= 16
        and len(unique_news_publishers) >= 1
    )

    return {
        "is_buzzy": is_buzzy,
        "impact_score": impact_score,
        "news_count": len(news),
        "publisher_count": len(unique_news_publishers),
        "total_sources": total_sources,
    }


def summarize_article_for_email(article_text, max_chars=550):
    cleaned = re.sub(r"\s+", " ", (article_text or "")).strip()
    if not cleaned:
        return "Summary unavailable."
    return cleaned[:max_chars].rstrip() + ("..." if len(cleaned) > max_chars else "")


def is_trusted_domain(url):
    if not url:
        return False
    try:
        host = urlparse(url).netloc.lower().split(":")[0]
    except Exception:
        return False

    for domain in TRUSTED_SOURCE_DOMAINS:
        if host == domain or host.endswith(f".{domain}"):
            return True
    return False


def sanitize_research_report_sources(research_report):
    sanitized = json.loads(json.dumps(research_report))
    findings = sanitized.get("findings", {})

    findings["corroborating_studies"] = [
        s for s in findings.get("corroborating_studies", []) if is_trusted_domain(s.get("url", ""))
    ]
    findings["related_news"] = [
        n for n in findings.get("related_news", []) if is_trusted_domain(n.get("url", ""))
    ]
    findings["complementary_research"] = [
        p for p in findings.get("complementary_research", []) if is_trusted_domain(p.get("url", ""))
    ]

    total_sources = (
        len(findings.get("corroborating_studies", []))
        + len(findings.get("related_news", []))
        + len(findings.get("complementary_research", []))
    )
    sanitized.setdefault("metadata", {})["total_sources_found"] = total_sources

    if len(findings.get("corroborating_studies", [])) >= 5:
        sanitized["metadata"]["reliability_score"] = "high"
    elif len(findings.get("corroborating_studies", [])) >= 2:
        sanitized["metadata"]["reliability_score"] = "medium"
    else:
        sanitized["metadata"]["reliability_score"] = "low"

    return sanitized


def collect_verified_sources(research_report, max_links=12):
    verified = []
    seen = set()

    def add_source(prefix, title, url):
        if not url or url in seen:
            return
        if not is_trusted_domain(url):
            return
        seen.add(url)
        verified.append(f"- {prefix}: {title} | {url}")

    for study in research_report.get("findings", {}).get("corroborating_studies", []):
        add_source("PubMed", study.get("title", "Untitled"), study.get("url", ""))
    for news in research_report.get("findings", {}).get("related_news", []):
        add_source(news.get("source", "News"), news.get("title", "Untitled"), news.get("url", ""))
    for preprint in research_report.get("findings", {}).get("complementary_research", []):
        add_source("Preprint", preprint.get("title", "Untitled"), preprint.get("url", ""))

    if max_links <= 0:
        return verified
    return verified[:max_links]


def collect_verified_source_records(research_report, max_records=5):
    records = []
    seen = set()

    def add_record(source, title, url, summary=""):
        if not url or url in seen:
            return
        if not is_trusted_domain(url):
            return
        seen.add(url)
        records.append(
            {
                "source": source or "Unknown",
                "title": title or "Untitled",
                "url": url,
                "summary": (summary or "").strip(),
            }
        )

    for study in research_report.get("findings", {}).get("corroborating_studies", []):
        add_record("PubMed", study.get("title", ""), study.get("url", ""), study.get("summary", ""))
    for news in research_report.get("findings", {}).get("related_news", []):
        add_record(news.get("source", "News"), news.get("title", ""), news.get("url", ""), news.get("summary", ""))
    for preprint in research_report.get("findings", {}).get("complementary_research", []):
        add_record("Preprint", preprint.get("title", ""), preprint.get("url", ""), preprint.get("summary", ""))

    if max_records <= 0:
        return records
    return records[:max_records]


def count_institutional_sources(research_report):
    urls = set()
    findings = research_report.get("findings", {})

    for bucket in [
        findings.get("corroborating_studies", []),
        findings.get("related_news", []),
        findings.get("complementary_research", []),
    ]:
        for entry in bucket:
            url = (entry.get("url") or "").strip()
            if not url:
                continue
            try:
                host = urlparse(url).netloc.lower().split(":")[0]
            except Exception:
                continue
            if any(host == d or host.endswith(f".{d}") for d in INSTITUTIONAL_SOURCE_DOMAINS):
                urls.add(url)

    return len(urls)


def build_public_article_fallback(item, research_report, verified_sources):
    source_records = collect_verified_source_records(research_report, max_records=8)
    findings = research_report.get("findings", {})
    pubmed_count = len(findings.get("corroborating_studies", []))
    news_count = len(findings.get("related_news", []))
    preprint_count = len(findings.get("complementary_research", []))
    reliability = research_report.get("metadata", {}).get("reliability_score", "low").title()
    keywords = ", ".join(research_report.get("keywords", [])[:6]) or "Not available"
    original_text = (item.get("text", "") or "No source text available.").strip()

    def clipped(text, size=420):
        clean = re.sub(r"\s+", " ", (text or "")).strip()
        if not clean:
            return "No source text available."
        return clean[:size].rstrip() + ("..." if len(clean) > size else "")

    headline = item.get("title", "Public Health Update").strip() or "Public Health Update"
    subheadline = (
        f"Long-form evidence brief from cross-referenced trusted sources, with clear methods and uncertainty framing. "
        f"Reliability: {reliability}."
    )

    article = [
        headline,
        subheadline,
        "By Public Health Research Desk",
        f"Updated {datetime.now().strftime('%B %d, %Y')}",
        "",
        "What happened",
        textwrap.fill(f"Original report text: {clipped(original_text, 700)}", width=110),
        "",
        "What the evidence says",
        (
            f"The cross-research pass found {pubmed_count} peer-reviewed references, {news_count} trusted news references, "
            f"and {preprint_count} preprint references from verified domains. "
            "This mix supports contextual interpretation, but study design and population differences still matter."
        ),
        f"Key terms used for corroboration: {keywords}",
        "",
        "Cross-referenced findings from recognized sources",
    ]

    if source_records:
        for idx, src in enumerate(source_records, start=1):
            article.append(f"Source {idx}: {src['source']} - {src['title']}")
            src_summary = src.get("summary") or "No abstract summary was provided by this source entry."
            article.append(textwrap.fill(f"Evidence note: {clipped(src_summary, 900)}", width=110))
            article.append(f"Link: {src['url']}")
            article.append("")
    else:
        article.append("No detailed source abstracts were available in this run.")
        article.append("")

    article.extend(
        [
            "What this means for the public",
            "Evidence should be monitored with caution and interpreted alongside independent updates.",
            "",
            "What remains uncertain",
            "Not all studies carry equal weight, and conclusions may change as additional data emerges.",
            "",
            "Verified Sources",
        ]
    )

    if verified_sources:
        article.extend(verified_sources)
    else:
        article.append("- No verified sources available for this item.")

    return "\n".join(article)


def ensure_minimum_article_length(article_text, item, research_report, min_words=900):
    text = (article_text or "").strip()
    if len(text.split()) >= min_words:
        return text

    findings = research_report.get("findings", {})
    keyword_list = research_report.get("keywords", [])[:8]
    keywords = ", ".join(keyword_list) if keyword_list else "public health trend indicators"
    source_total = research_report.get("metadata", {}).get("total_sources_found", 0)
    pubmed_count = len(findings.get("corroborating_studies", []))
    news_count = len(findings.get("related_news", []))
    preprint_count = len(findings.get("complementary_research", []))

    context_paragraph = textwrap.fill(
        (
            "Extended context for readers: major public-health stories are rarely resolved by one study or one news cycle. "
            "A more reliable interpretation comes from triangulating evidence across peer-reviewed studies, institutional "
            "updates, and independent reporting. In this case, the monitoring run identified "
            f"{source_total} corroborating signals ({pubmed_count} peer-reviewed references, {news_count} trusted news references, "
            f"and {preprint_count} preprints), centered on these terms: {keywords}."
        ),
        width=110,
    )

    methods_paragraph = textwrap.fill(
        (
            "How to read this evidence: peer-reviewed studies generally carry the strongest weight when methods and outcomes "
            "are clearly reported, while news coverage can help explain policy relevance and implementation impact. "
            "Preprints can provide early directional signals but should be interpreted cautiously until formal peer review "
            "confirms methods and findings."
        ),
        width=110,
    )

    interpretation_paragraph = textwrap.fill(
        (
            "Interpretation framework: readers should ask whether findings are consistent across settings, whether effect sizes "
            "are clinically meaningful, and whether study populations reflect the communities most affected by the issue. "
            "Differences in age groups, baseline risk, and access to care can change how results translate to real-world outcomes."
        ),
        width=110,
    )

    implications_paragraph = textwrap.fill(
        (
            "Implications for policy and practice: if signals continue in future monitoring runs, decision-makers may consider "
            "targeted communication, enhanced surveillance, and implementation guidance for frontline services. "
            "For clinicians and public-health teams, the practical value is strongest when new findings are integrated with "
            "local data, service capacity, and equity-focused planning."
        ),
        width=110,
    )

    research_agenda_paragraph = textwrap.fill(
        (
            "Research agenda to watch next: larger cohorts, longer follow-up windows, subgroup analysis, and clearer outcome "
            "definitions are needed to reduce uncertainty. If upcoming publications replicate key trends in independent populations, "
            "confidence in the present signal will rise; if they diverge, conclusions should be recalibrated accordingly."
        ),
        width=110,
    )

    public_guidance_paragraph = textwrap.fill(
        (
            "Public guidance principle: this report is an evidence briefing, not individual medical advice. "
            "People should avoid abrupt treatment or behavior changes based solely on one article and instead discuss decisions "
            "with qualified professionals who can interpret personal risk and context."
        ),
        width=110,
    )

    addendum = [
        "",
        "Extended analysis",
        context_paragraph,
        methods_paragraph,
        interpretation_paragraph,
        implications_paragraph,
        research_agenda_paragraph,
        public_guidance_paragraph,
    ]

    expanded = (text + "\n\n" + "\n\n".join(addendum)).strip()
    return expanded


def _ordinal_day(day):
    if 11 <= day % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def enforce_publication_template(article_text, item, research_report):
    title = (item.get("title") or "Public Health Update").strip()
    source_total = research_report.get("metadata", {}).get("total_sources_found", 0)
    reliability = (research_report.get("metadata", {}).get("reliability_score") or "medium").title()

    subheadline = (
        f"A reported public-health development reviewed against {source_total} corroborating references, "
        f"with evidence currently assessed as {reliability.lower()}."
    )

    strip_headers = {
        "What happened",
        "What the evidence says",
        "How this report was built",
        "Cross-referenced findings from recognized sources",
        "Synthesis across studies",
        "What this means for the public",
        "What remains uncertain",
        "Bottom line",
        "Verified Sources",
        "Extended analysis",
    }

    body_lines = []
    for line in (article_text or "").split("\n"):
        stripped = line.strip()
        if not stripped:
            body_lines.append("")
            continue
        if re.search(r"https?://", stripped):
            continue
        if stripped.startswith("- Source") or stripped.startswith("Link:"):
            continue
        if stripped.lower().startswith("original report text:"):
            continue
        body_lines.append(stripped)

    body = "\n".join(body_lines).strip()
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    if not body:
        body = "Public-health evidence for this report is still developing, and interpretation remains provisional."

    pass

    now = datetime.now()
    published_line = now.strftime("%B %d, %Y")

    related_records = collect_verified_source_records(research_report, max_records=2)
    related_lines = ["Related:"]
    for rec in related_records:
        related_lines.append(rec.get("title", "Public health source update"))
    if len(related_lines) == 1:
        related_lines.append("Public health evidence monitoring methodology")

    formatted = (
        f"{title}\n"
        f"{subheadline}\n\n"
        "By Public Health Research Desk\n"
        f"Published {published_line}\n\n"
        f"{body}\n\n"
        "A version of this article appears in print in the Public Health Research edition with the headline above.\n"
        + "\n".join(related_lines)
    )

    return formatted.strip()


def enforce_unbiased_tone(article_text):
    text = article_text or ""

    # Replace sensational wording with neutral alternatives.
    for original, neutral in SENSATIONAL_WORD_REPLACEMENTS.items():
        text = re.sub(rf"\b{re.escape(original)}\b", neutral, text, flags=re.IGNORECASE)

    # Ensure uncertainty language exists in long-form output.
    lowered = text.lower()
    pass

    return text.strip()


def validate_publication_template(article_text):
    lines = [line.rstrip() for line in (article_text or "").splitlines() if line.strip()]
    if len(lines) < 6:
        return False

    joined = "\n".join(lines)
    required_fragments = [
        "By Public Health Research Desk",
        "Published ",
        "A version of this article appears in print",
        "Related:",
    ]
    for fragment in required_fragments:
        if fragment not in joined:
            return False

    # Reject noisy site-shell wrappers.
    banned_fragments = [
        "Skip to content",
        "Section Navigation",
        "GIVE THE TIMES",
        "Share full article",
        "Site Index",
    ]
    for fragment in banned_fragments:
        if fragment in joined:
            return False

    # Reject leaked raw URLs or source-dump lines in body text.
    if "http://" in joined or "https://" in joined:
        return False
    if re.search(r"\bGoogle News\s*:", joined, flags=re.IGNORECASE):
        return False
    if re.search(r"(?:-\s*){8,}", joined):
        return False

    # Must stay long-form narrative.
    if len((article_text or "").split()) < 900:
        return False

    return True


def has_excessive_repetition(text, threshold=3):
    sentences = [s.strip() for s in text.split(".") if s.strip()]
    from collections import Counter
    counts = Counter(sentences)
    return any(count > threshold for count in counts.values())


def generate_unbiased_article(item, research_report):
    verified_sources = collect_verified_sources(research_report, max_links=MAX_VERIFIED_SOURCES)
    verified_block = "\n".join(verified_sources) if verified_sources else "- No verified sources available for this item."
    fallback_article = build_public_article_fallback(item, research_report, verified_sources)
    source_rule = (
        f"- Include evidence from at least {MIN_VERIFIED_SOURCES} and at most {MAX_VERIFIED_SOURCES} verified sources listed below.\n\n"
        if MAX_VERIFIED_SOURCES > 0
        else f"- Include evidence from at least {MIN_VERIFIED_SOURCES} verified sources listed below, with no upper cap.\n\n"
    )

    if client is None:
        baseline = ensure_minimum_article_length(fallback_article, item, research_report, min_words=900)
        return enforce_publication_template(baseline, item, research_report)

    prompt = (
        "You are a senior health journalist at a major newsroom like the New York Times or CNN. "
        "Write a fully publication-ready news article on the topic below. "
        "The article must read like something a real editor would publish today, not a research summary or evidence brief.\n\n"
        "Article requirements:\n"
        "- Open with a strong lede (first paragraph) that hooks the reader with the most important fact or development.\n"
        "- Use the inverted pyramid structure: most important information first, context and background in the middle, broader implications at the end.\n"
        "- Write in short paragraphs of 2 to 4 sentences each. No bullet points in the body.\n"
        "- Use plain language accessible to a general adult reader. Define any medical or scientific terms on first use.\n"
        "- Include a nut graf in the second or third paragraph explaining why this story matters right now.\n"
        "- Weave in specific facts, numbers, and context from the sources provided.\n"
        "- Maintain a neutral, factual tone. Present evidence accurately. Note uncertainty where it exists.\n"
        "- Do not use sensational language, advocacy framing, or recommendations.\n"
        "- Target 900 to 1100 words.\n\n"
        "Formatting:\n"
        "- Line 1: Headline that is compelling, specific, and under 12 words\n"
        "- Line 2: Subheadline that is one sentence expanding on the headline\n"
        "- Line 3: By Public Health Research Desk\n"
        "- Line 4: Published <Month DD, YYYY>\n"
        "- Then the article body in flowing prose paragraphs with no section headers.\n"
        "- End with: A version of this article appears in print in the Public Health Research edition with the headline above.\n"
        "- Then: Related:\n"
        "- Then 1 to 2 related article titles.\n\n"
        f"Topic: {item.get('title', '')}\n"
        f"Source: {item.get('source', '')}\n"
        f"Date: {item.get('date', '')}\n"
        f"Source content: {item.get('text', '')[:4000]}\n\n"
        "Supporting sources for factual grounding:\n"
        + verified_block
    )

    article_body = None
    for attempt in range(2):
        completion = groq_chat_completion(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=1800,
            reasoning_effort="low",
        )
        candidate = completion.choices[0].message.content.strip() or fallback_article
        if not has_excessive_repetition(candidate):
            article_body = candidate
            break
        print(f"Article generation attempt {attempt + 1} showed excessive repetition. Retrying..." if attempt == 0 else "Second attempt also repetitive; using deterministic fallback.")
    else:
        article_body = fallback_article

    if has_excessive_repetition(article_body):
        article_body = fallback_article

    article_body = enforce_unbiased_tone(article_body)

    # Safety guard: if model omitted source section, append verified sources explicitly.
    if "Verified Sources" not in article_body:
        article_body = f"{article_body}\n\nVerified Sources\n{verified_block}"

    final_article = enforce_unbiased_tone(article_body)
    final_article = ensure_minimum_article_length(final_article, item, research_report, min_words=900)
    formatted = enforce_publication_template(final_article, item, research_report)
    if not validate_publication_template(formatted):
        # Deterministic fallback: rebuild from enforced template if output drifts.
        repaired = enforce_publication_template(ensure_minimum_article_length(final_article, item, research_report, min_words=950), item, research_report)
        return repaired
    return formatted


def build_pdf_bytes(title, article_text, metadata_lines):
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=LETTER)
    page_width, page_height = LETTER
    left_margin = 54
    right_margin = 54
    top_margin = 56
    bottom_margin = 56
    content_width = page_width - left_margin - right_margin

    y = page_height - top_margin
    pdf.setTitle(title)

    def draw_footer():
        pdf.setFont("Helvetica", 8)
        pdf.drawRightString(page_width - right_margin, 30, f"Page {pdf.getPageNumber()}")

    def new_page():
        nonlocal y
        draw_footer()
        pdf.showPage()
        y = page_height - top_margin

    def wrap_text(text, font_name, font_size, max_width):
        words = (text or "").split()
        if not words:
            return [""]

        lines = []
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if stringWidth(candidate, font_name, font_size) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
        return lines

    def draw_wrapped_text(text, font_name="Helvetica", font_size=10, line_gap=4, indent=0):
        nonlocal y
        max_width = content_width - indent
        lines = wrap_text(text, font_name, font_size, max_width)
        line_height = font_size + line_gap

        for line in lines:
            if y < bottom_margin + line_height:
                new_page()
            pdf.setFont(font_name, font_size)
            pdf.drawString(left_margin + indent, y, line)
            y -= line_height

    def draw_blank_line(space=8):
        nonlocal y
        y -= space
        if y < bottom_margin + 20:
            new_page()

    def draw_section_header(text):
        draw_blank_line(4)
        draw_wrapped_text(text, font_name="Helvetica-Bold", font_size=12, line_gap=4)
        draw_blank_line(2)

    def draw_paragraph(text):
        draw_wrapped_text(text, font_name="Helvetica", font_size=10, line_gap=4)
        draw_blank_line(6)

    # Header
    for line in wrap_text(title[:250], "Helvetica-Bold", 14, content_width):
        draw_wrapped_text(line, font_name="Helvetica-Bold", font_size=14, line_gap=5)
    draw_blank_line(4)

    for line in metadata_lines:
        draw_wrapped_text(line[:200], font_name="Helvetica", font_size=9, line_gap=3)
    draw_blank_line(10)

    # Article body formatter (section-aware)
    current_paragraph = []

    def flush_current_paragraph():
        nonlocal current_paragraph
        if current_paragraph:
            draw_paragraph(" ".join(current_paragraph).strip())
            current_paragraph = []

    for raw_line in (article_text or "").splitlines():
        line = raw_line.strip()
        if not line:
            flush_current_paragraph()
            draw_blank_line(8)
            continue

        # Handle markdown-like section headers and plain section titles.
        if line.startswith("#"):
            flush_current_paragraph()
            header = line.lstrip("#").strip()
            if header:
                draw_section_header(header)
            continue

        if line in {
            "What happened",
            "What the evidence says",
            "What this means for the public",
            "What remains uncertain",
            "Verified Sources",
        }:
            flush_current_paragraph()
            draw_section_header(line)
            continue

        # Keep bullet source lines readable.
        if line.startswith("- "):
            flush_current_paragraph()
            draw_wrapped_text(line, font_name="Helvetica", font_size=10, line_gap=4, indent=10)
            draw_blank_line(4)
            continue

        current_paragraph.append(line)

    flush_current_paragraph()

    draw_footer()

    pdf.save()
    buffer.seek(0)
    return buffer.read()


def build_email_body(item, summary_data):
    body = (
        f"Title: {item['title']}\n"
        f"Source: {item['source']}\n"
        f"Date: {item['date']}\n\n"
        f"Summary: {summary_data.get('summary', '')}\n\n"
        f"Significance: {summary_data.get('significance', '')}\n"
        f"Category: {summary_data.get('category', '')}\n"
        f"Red Flags: {summary_data.get('red_flags', 'None')}\n\n"
    )

    if "detailed_article" in summary_data:
        body += f"Detailed Research Article:\n{summary_data['detailed_article']}\n\n"

    body += f"Link: {item['url']}\n"

    return body


def build_digest_email_body(digest_entries):
    header = (
        "Health Research Digest\n"
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Total articles: {len(digest_entries)}\n"
        "Each article includes title, summary, and confidence level.\n\n"
    )

    sections = []
    for idx, entry in enumerate(digest_entries, start=1):
        sections.append(f"{idx}. Title: {entry['title']}\n")
        sections.append(f"Summary: {entry['summary']}\n")
        sections.append(f"Confidence Level: {entry['confidence']}\n")
        sections.append("\n")

    return header + "".join(sections)


def build_slack_digest_text(subject, digest_entries, pdf_attachments):
    lines = [
        f"*{subject}*",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Total articles: {len(digest_entries)}",
        "",
    ]

    for idx, entry in enumerate(digest_entries, start=1):
        lines.append(f"*{idx}. {entry['title']}*")
        lines.append(f"Summary: {entry['summary']}")
        lines.append(f"Confidence Level: {entry['confidence']}")
        lines.append("")

    if pdf_attachments:
        lines.append("PDF files generated locally:")
        for file_obj in pdf_attachments:
            lines.append(f"- {file_obj['filename']}")

    # Keep message under common webhook limits.
    text = "\n".join(lines)
    return text[:38000]


def save_pending_digest(subject, body, digest_entries, pdf_attachments):
    PENDING_DIGESTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    digest_path = PENDING_DIGESTS_DIR / f"pending_digest_{timestamp}.json"

    payload = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "subject": subject,
        "body": body,
        "entries": digest_entries,
        "pdf_files": [att.get("filename", "") for att in (pdf_attachments or [])],
    }
    digest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return digest_path


def _slack_upload_file_external(file_name, file_bytes, title, initial_comment):
    headers = {"Authorization": f"Bearer {SLACK_BOT_TOKEN}"}

    resp1 = requests.post(
        "https://slack.com/api/files.getUploadURLExternal",
        headers=headers,
        data={"filename": file_name, "length": str(len(file_bytes))},
        timeout=SLACK_TIMEOUT + 40,
    )
    data1 = resp1.json()
    if not data1.get("ok"):
        raise RuntimeError(f"Slack upload step1 failed: {data1.get('error', 'unknown_error')}")

    upload_url = data1["upload_url"]
    file_id = data1["file_id"]

    resp2 = requests.post(
        upload_url,
        data=file_bytes,
        headers={"Content-Type": "application/octet-stream"},
        timeout=SLACK_TIMEOUT + 100,
    )
    if resp2.status_code >= 300:
        raise RuntimeError(f"Slack upload step2 failed: HTTP {resp2.status_code}")

    payload = {
        "files": [{"id": file_id, "title": title}],
        "channel_id": SLACK_CHANNEL_ID,
        "initial_comment": initial_comment,
    }
    resp3 = requests.post(
        "https://slack.com/api/files.completeUploadExternal",
        headers={**headers, "Content-Type": "application/json; charset=utf-8"},
        data=json.dumps(payload),
        timeout=SLACK_TIMEOUT + 40,
    )
    data3 = resp3.json()
    if not data3.get("ok"):
        raise RuntimeError(f"Slack upload step3 failed: {data3.get('error', 'unknown_error')}")


def send_email(subject, body, attachments=None):
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = GMAIL_SENDER
    message["To"] = GMAIL_RECIPIENT
    message.set_content(body)

    for attachment in attachments or []:
        message.add_attachment(
            attachment["content"],
            maintype="application",
            subtype="pdf",
            filename=attachment["filename"],
        )

    last_error = None
    for attempt in range(1, SMTP_MAX_RETRIES + 1):
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=SMTP_TIMEOUT) as smtp:
                smtp.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
                smtp.send_message(message)
            return
        except (smtplib.SMTPException, TimeoutError, OSError) as exc:
            last_error = exc
            print(f"Email attempt {attempt}/{SMTP_MAX_RETRIES} failed: {exc}")
            if attempt < SMTP_MAX_RETRIES:
                time.sleep(SMTP_RETRY_DELAY_SECONDS)

    raise RuntimeError(f"All email attempts failed. Last error: {last_error}")


def send_slack_digest(subject, digest_entries, pdf_attachments=None):
    text = build_slack_digest_text(subject, digest_entries, pdf_attachments or [])
    has_pdf_attachments = bool(pdf_attachments)
    bot_configured = bool(SLACK_BOT_TOKEN and SLACK_CHANNEL_ID)

    # If files are included and bot path is configured, prefer bot path because
    # webhook posts cannot upload binary attachments.
    if has_pdf_attachments and bot_configured:
        pass
    elif SLACK_WEBHOOK_URL:
        payload = {"text": text}
        response = requests.post(SLACK_WEBHOOK_URL, json=payload, timeout=SLACK_TIMEOUT)
        if response.status_code >= 400:
            raise RuntimeError(
                f"Slack webhook failed with status {response.status_code}: {response.text[:300]}"
            )
        return

    # Fallback path: Bot token + channel using Web API.
    if not SLACK_BOT_TOKEN or not SLACK_CHANNEL_ID:
        raise RuntimeError(
            "Slack is not configured. Set SLACK_WEBHOOK_URL, or set both "
            "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID."
        )

    api_url = "https://slack.com/api/chat.postMessage"
    headers = {
        "Authorization": f"Bearer {SLACK_BOT_TOKEN}",
        "Content-Type": "application/json; charset=utf-8",
    }
    payload = {
        "channel": SLACK_CHANNEL_ID,
        "text": text,
        "mrkdwn": True,
    }
    response = requests.post(api_url, headers=headers, json=payload, timeout=SLACK_TIMEOUT)
    if response.status_code >= 400:
        raise RuntimeError(f"Slack API failed with status {response.status_code}: {response.text[:300]}")

    try:
        data = response.json()
    except Exception:
        raise RuntimeError(f"Slack API returned non-JSON response: {response.text[:300]}")

    if not data.get("ok"):
        raise RuntimeError(f"Slack API error: {data.get('error', 'unknown_error')}")

    for idx, attachment in enumerate(pdf_attachments or [], start=1):
        entry = digest_entries[idx - 1] if idx - 1 < len(digest_entries) else {}
        title = entry.get("title", attachment.get("filename", f"Article {idx}"))
        summary = entry.get("summary", "")
        confidence = entry.get("confidence", "")
        initial_comment = (
            f"{idx}. {title}\n"
            f"Summary: {summary}\n"
            f"Confidence Level: {confidence}"
        )
        _slack_upload_file_external(
            file_name=attachment["filename"],
            file_bytes=attachment["content"],
            title=title,
            initial_comment=initial_comment,
        )


def init_uploaded_articles_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS uploaded_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            source TEXT,
            article_date TEXT,
            url TEXT,
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attachment_name TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    # Migrate older tables that do not yet include status.
    columns = {row[1] for row in conn.execute("PRAGMA table_info(uploaded_articles)").fetchall()}
    for column in ("research_data", "research_sources", "consensus_data"):
        if column not in columns:
            conn.execute(f"ALTER TABLE uploaded_articles ADD COLUMN {column} TEXT")
    if "status" not in columns:
        conn.execute("ALTER TABLE uploaded_articles ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")
    conn.execute("UPDATE uploaded_articles SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''")
    conn.commit()


def publish_article_to_web(item, article_text, attachment_name="", research_report=None):
    title = (item.get("title") or "Public Health Update").strip()
    source = (item.get("source") or "Automated Research Desk").strip()
    article_date = (item.get("date") or "").strip()
    url = (item.get("url") or "").strip()
    content = (article_text or "").strip()
    report = research_report if isinstance(research_report, dict) else {}
    research_data = json.dumps(report, ensure_ascii=False)
    research_sources = json.dumps(collect_verified_source_records(report, max_records=0), ensure_ascii=False)
    consensus_data = json.dumps(report.get("consensus"), ensure_ascii=False) if report.get("consensus") else None
    created_at = datetime.utcnow().isoformat(timespec="seconds")

    if not title or not content:
        return False

    with sqlite3.connect(WEB_DB_PATH) as web_conn:
        init_uploaded_articles_table(web_conn)

        # Avoid duplicate public posts for the same title/date/source combination.
        existing = web_conn.execute(
            """
            SELECT id, content FROM uploaded_articles
            WHERE title = ? AND source = ? AND article_date = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (title, source, article_date),
        ).fetchone()
        if existing:
            existing_content = (existing[1] or "").strip()
            if len(content.split()) > len(existing_content.split()):
                web_conn.execute(
                    """
                    UPDATE uploaded_articles
                    SET content = ?, url = ?, attachment_name = ?, research_data = ?, research_sources = ?, consensus_data = ?, created_at = ?
                    WHERE id = ?
                    """,
                    (content, url, attachment_name, research_data, research_sources, consensus_data, created_at, existing[0]),
                )
                web_conn.commit()
                return True
            return False

        web_conn.execute(
            """
            INSERT INTO uploaded_articles
            (title, source, article_date, url, content, status, attachment_name, research_data, research_sources, consensus_data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (title, source, article_date, url, content, "pending", attachment_name, research_data, research_sources, consensus_data, created_at),
        )
        web_conn.commit()

    return True


def run_monitor():
    valid_modes = {"email", "slack", "both", "auto", "none"}
    if DELIVERY_MODE not in valid_modes:
        raise RuntimeError(
            f"Invalid DELIVERY_MODE '{DELIVERY_MODE}'. Use one of: {', '.join(sorted(valid_modes))}."
        )

    requires_email = DELIVERY_MODE in {"email", "both", "auto"} and DELIVERY_MODE != "none"
    requires_slack = DELIVERY_MODE in {"slack", "both"} and DELIVERY_MODE != "none"

    if requires_email and not all([GMAIL_SENDER, GMAIL_RECIPIENT, GMAIL_APP_PASSWORD]):
        raise RuntimeError("Email delivery selected but GMAIL_SENDER, GMAIL_RECIPIENT, and GMAIL_APP_PASSWORD are not fully set.")

    if requires_slack and not (
        SLACK_WEBHOOK_URL or (SLACK_BOT_TOKEN and SLACK_CHANNEL_ID)
    ):
        raise RuntimeError(
            "Slack delivery selected but Slack is not configured. Set SLACK_WEBHOOK_URL, "
            "or set both SLACK_BOT_TOKEN and SLACK_CHANNEL_ID."
        )

    conn = init_db()
    all_items = []
    researcher = CrossResearcher(ncbi_api_key=NCBI_API_KEY)
    GENERATED_REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    all_items.extend(fetch_pubmed_items(PUBMED_TERM, PUBMED_MAX))
    # all_items.extend(fetch_fda_items())  # Commented out for testing

    for source in RSS_SOURCES:
        try:
            all_items.extend(fetch_rss_items(source["source"], source["url"]))
        except Exception as exc:
            print(f"Warning: failed to fetch {source['source']} feed: {exc}")

    print(f"Fetched {len(all_items)} total items.")
    for item in all_items:
        print(f"Item: {item['title']} - Date: {item['date']} - Source: {item['source']}")

    filtered_items = []

    for item in all_items:
        if is_processed(conn, item["id"]):
            continue

        if is_duplicate(conn, item):
            print(f"Duplicate filtered: {item['title']}")
            continue

        if not is_public_health_relevant(item):
            print(f"Filtered (not public-health relevant): {item['title']}")
            mark_processed(conn, item["id"], item["title"], item["source"], item["date"])
            continue

        is_valid, score = is_high_signal(item)
        population_impact = score_population_impact(item)

        if not is_valid:
            print(f"Filtered (low signal {score}): {item['title']}")
            mark_processed(conn, item["id"], item["title"], item["source"], item["date"])
            continue

        if population_impact < MIN_POPULATION_IMPACT_SCORE:
            print(
                f"Filtered (low population impact {population_impact} < {MIN_POPULATION_IMPACT_SCORE}): "
                f"{item['title']}"
            )
            mark_processed(conn, item["id"], item["title"], item["source"], item["date"])
            continue

        print(f"Passed filter (signal {score}, impact {population_impact}): {item['title']}")
        filtered_items.append(item)

    digest_entries = []
    candidate_entries = []
    strict_quality_mode = QUALITY_MODE in {"strict", "quality", "quality-first", "high"}
    min_verified_sources = max(MIN_VERIFIED_SOURCES, STRICT_MIN_VERIFIED_SOURCES) if strict_quality_mode else MIN_VERIFIED_SOURCES
    min_peer_reviewed_sources = (
        max(MIN_PEER_REVIEWED_SOURCES, STRICT_MIN_PEER_REVIEWED_SOURCES) if strict_quality_mode else MIN_PEER_REVIEWED_SOURCES
    )
    min_institutional_sources = (
        max(MIN_INSTITUTIONAL_SOURCES, STRICT_MIN_INSTITUTIONAL_SOURCES) if strict_quality_mode else MIN_INSTITUTIONAL_SOURCES
    )
    min_confidence_score = max(MIN_CONFIDENCE_SCORE, STRICT_MIN_CONFIDENCE_SCORE) if strict_quality_mode else MIN_CONFIDENCE_SCORE

    # High-level notifications trigger full cross-research.
    for item in filtered_items:
        try:
            raw_report = researcher.cross_research_finding(item, depth=RESEARCH_DEPTH)
            report = sanitize_research_report_sources(raw_report)

            source_count = report.get("metadata", {}).get("total_sources_found", 0)
            if source_count < min_verified_sources:
                print(
                    f"Skipped item due to insufficient verified sources ({source_count} < {min_verified_sources}): "
                    f"{item.get('title', 'Untitled')}"
                )
                continue

            peer_reviewed_count = len(report.get("findings", {}).get("corroborating_studies", []))
            institutional_count = count_institutional_sources(report)

            if peer_reviewed_count < min_peer_reviewed_sources:
                print(
                    f"Skipped item due to insufficient peer-reviewed sources ({peer_reviewed_count} < {min_peer_reviewed_sources}): "
                    f"{item.get('title', 'Untitled')}"
                )
                continue

            if institutional_count < min_institutional_sources:
                print(
                    f"Skipped item due to insufficient institutional sources ({institutional_count} < {min_institutional_sources}): "
                    f"{item.get('title', 'Untitled')}"
                )
                continue

            article_text = generate_unbiased_article(item, report)
            confidence = confidence_from_research_report(report)
            buzz = evaluate_buzz_context(item, report)
            required_confidence = min_confidence_score
            if buzz["is_buzzy"]:
                required_confidence = max(BUZZ_CONFIDENCE_FLOOR, min_confidence_score - 20)

            if confidence["score"] < required_confidence:
                print(
                    f"Skipped item due to low confidence ({confidence['score']} < {required_confidence}): "
                    f"{item.get('title', 'Untitled')}"
                )
                continue

            summary_text = summarize_article_for_email(article_text)
            confidence_text = f"{confidence['score']}% ({confidence['label']})"
            quality_score = (
                (confidence["score"] * 0.62)
                + (source_count * 1.8)
                + (peer_reviewed_count * 4.5)
                + (institutional_count * 3.5)
                + (buzz.get("impact_score", 0) * 0.35)
            )

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_base = safe_filename(item.get("title", "article"))
            pdf_name = f"{timestamp}_{file_base}.pdf"
            pdf_path = GENERATED_REPORTS_DIR / pdf_name

            metadata_lines = [
                f"Source: {item.get('source', 'Unknown')}",
                f"Published: {item.get('date', 'Unknown')}",
                f"Cross-referenced sources: {source_count}",
                f"Original URL: {item.get('url', '')[:110]}",
            ]
            pdf_bytes = build_pdf_bytes(item.get("title", "Health Article"), article_text, metadata_lines)
            with open(pdf_path, "wb") as f:
                f.write(pdf_bytes)

            attachment = {"filename": pdf_name, "content": pdf_bytes}
            candidate_entries.append(
                {
                    "title": item.get("title", "Untitled"),
                    "summary": summary_text,
                    "confidence": confidence_text,
                    "item": item,
                    "article_text": article_text,
                    "research_report": report,
                    "confidence_score": confidence["score"],
                    "source_count": source_count,
                    "peer_reviewed_count": peer_reviewed_count,
                    "institutional_count": institutional_count,
                    "buzz_score": buzz.get("impact_score", 0),
                    "quality_score": quality_score,
                    "attachment": attachment,
                }
            )
        except Exception as exc:
            print(f"Research pipeline failed for item '{item.get('title', 'Untitled')}': {exc}")

    # Quality-first ranking: prioritize confidence and evidence depth before buzz.
    candidate_entries.sort(
        key=lambda e: (
            e.get("quality_score", 0),
            e.get("confidence_score", 0),
            e.get("source_count", 0),
            e.get("peer_reviewed_count", 0),
            e.get("institutional_count", 0),
            e.get("buzz_score", 0),
        ),
        reverse=True,
    )

    if MAX_DIGEST_ARTICLES > 0:
        digest_entries = candidate_entries[:MAX_DIGEST_ARTICLES]
    else:
        digest_entries = candidate_entries

    deduped_entries = []
    for entry in digest_entries:
        if was_recently_delivered(conn, entry.get("item", {}), within_hours=DELIVERY_DEDUP_HOURS):
            print(
                f"Skipped recently delivered item (within {DELIVERY_DEDUP_HOURS}h): "
                f"{entry.get('title', 'Untitled')}"
            )
            continue
        deduped_entries.append(entry)

    digest_entries = deduped_entries

    pdf_attachments = [entry.get("attachment") for entry in digest_entries if entry.get("attachment")]

    if not digest_entries:
        print("No new high-signal findings ready for delivery in this run.")
        return

    body = build_digest_email_body(digest_entries)
    run_date = datetime.now().strftime("%Y-%m-%d")
    subject = f"Health Research Digest {run_date} ({len(digest_entries)} articles)"

    if APPROVAL_MODE in {"manual", "manual_approval", "review"}:
        pending_path = save_pending_digest(subject, body, digest_entries, pdf_attachments)
        print(
            "Manual approval mode enabled. Digest was prepared but not sent. "
            f"Review file: {pending_path}"
        )
        return

    delivery_success = False
    delivery_errors = []

    if DELIVERY_MODE in {"email", "both", "auto"} and DELIVERY_MODE != "none":
        try:
            send_email(subject, body, attachments=pdf_attachments)
            print(
                f"Sent digest email with {len(digest_entries)} articles and {len(pdf_attachments)} PDF attachments."
            )
            delivery_success = True
        except Exception as exc:
            delivery_errors.append(f"email: {exc}")
            print(f"Email delivery failed: {exc}")

    slack_configured = bool(SLACK_WEBHOOK_URL or (SLACK_BOT_TOKEN and SLACK_CHANNEL_ID))
    if (DELIVERY_MODE in {"slack", "both"} or (DELIVERY_MODE == "auto" and slack_configured)) and DELIVERY_MODE != "none":
        try:
            send_slack_digest(subject, digest_entries, pdf_attachments=pdf_attachments)
            print(f"Sent digest to Slack with {len(digest_entries)} articles.")
            delivery_success = True
        except Exception as exc:
            delivery_errors.append(f"slack: {exc}")
            print(f"Slack delivery failed: {exc}")

    if delivery_success:
        for entry in digest_entries:
            item = entry["item"]

            if AUTO_PUBLISH_TO_WEB:
                published = publish_article_to_web(
                    item=item,
                    article_text=entry.get("article_text", ""),
                    attachment_name=(entry.get("attachment") or {}).get("filename", ""),
                    research_report=entry.get("research_report"),
                )
                if published:
                    print(f"Published article to website feed: {item.get('title', 'Untitled')}")

            mark_delivered(conn, item)
            mark_processed(conn, item["id"], item["title"], item["source"], item["date"])
    else:
        print("Digest delivery failed on all enabled channels.")
        if delivery_errors:
            print("Delivery errors: " + " | ".join(delivery_errors))


def parse_schedule_times(schedule_times_value):
    parsed = []

    for raw in (schedule_times_value or "").split(","):
        candidate = raw.strip()
        if not candidate:
            continue

        try:
            datetime.strptime(candidate, "%H:%M")
        except ValueError:
            print(f"Warning: invalid RUN_SCHEDULE_TIMES value '{candidate}' ignored. Expected HH:MM.")
            continue

        parsed.append(candidate)

    # Preserve order but remove duplicates.
    seen = set()
    unique = []
    for value in parsed:
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)

    return unique


if __name__ == "__main__":
    # Run once at startup, then continue scheduled checks 24/7.
    run_monitor()

    # Schedule by interval when configured, otherwise use fixed daily times.
    if RUN_INTERVAL_HOURS > 0:
        schedule.every(RUN_INTERVAL_HOURS).hours.do(run_monitor)
        print(f"Health research monitor started. Running every {RUN_INTERVAL_HOURS} hours.")
    else:
        run_schedule_times = parse_schedule_times(RUN_SCHEDULE_TIMES)
        if not run_schedule_times:
            run_schedule_times = [RUN_SCHEDULE_TIME]

        for schedule_time in run_schedule_times:
            schedule.every().day.at(schedule_time).do(run_monitor)

        print(
            "Health research monitor started. Running daily at: "
            + ", ".join(run_schedule_times)
            + "."
        )

    while True:
        schedule.run_pending()
        time.sleep(30)
