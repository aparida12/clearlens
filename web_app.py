import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, render_template, request, url_for
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "processed_items.db"
UPLOADS_DIR = BASE_DIR / "uploads"
REPORTS_DIR = BASE_DIR / "generated_reports"
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".txt"}

app = Flask(__name__)
app.config['ENV'] = os.getenv('FLASK_ENV', 'development')
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_web_tables():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS uploaded_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                source TEXT,
                article_date TEXT,
                url TEXT,
                content TEXT NOT NULL,
                attachment_name TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        try:
            conn.execute("ALTER TABLE uploaded_articles ADD COLUMN attachment_name TEXT")
        except sqlite3.OperationalError:
            pass
        conn.commit()


def load_generated_articles(limit=50):
    """Load articles from generated_reports JSON files, newest first."""
    articles = []
    if not REPORTS_DIR.exists():
        return articles

    json_files = sorted(
        [f for f in REPORTS_DIR.glob("*.json")],
        key=lambda f: f.name,
        reverse=True
    )

    for filepath in json_files[:limit]:
        try:
            data = json.loads(filepath.read_text(encoding="utf-8"))
            article = data.get("article", {})
            social = data.get("social", {})

            # Skip entries with no real headline or body
            if not article.get("headline") or not article.get("body"):
                continue

            articles.append({
                "slug": filepath.stem,
                "headline": article.get("headline", ""),
                "summary": article.get("summary", ""),
                "body": article.get("body", ""),
                "takeaway": article.get("takeaway", ""),
                "source": data.get("source", "ClearLens"),
                "source_url": data.get("sourceUrl", ""),
                "generated_at": data.get("generatedAt", ""),
                "social": social,
                "research_sources": data.get("researchSources", []),
            })
        except Exception:
            continue

    return articles


def format_date(iso_string):
    """Format ISO timestamp to readable date."""
    try:
        dt = datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
        return dt.strftime("%B %d, %Y")
    except Exception:
        return iso_string


@app.route("/", methods=["GET"])
def public_home():
    articles = load_generated_articles(limit=50)

    for a in articles:
        a["date_formatted"] = format_date(a["generated_at"])

    featured = articles[0] if articles else None
    recent = articles[1:13] if len(articles) > 1 else []

    return render_template(
        "public_home.html",
        featured_article=featured,
        recent_articles=recent,
        total_articles=len(articles),
        today=datetime.now().strftime("%B %d, %Y"),
    )


@app.route("/article/<slug>", methods=["GET"])
def article_detail(slug):
    filepath = REPORTS_DIR / f"{slug}.json"
    if not filepath.exists():
        abort(404)

    try:
        data = json.loads(filepath.read_text(encoding="utf-8"))
    except Exception:
        abort(404)

    article = data.get("article", {})
    social = data.get("social", {})

    all_articles = load_generated_articles(limit=20)
    related = [a for a in all_articles if a["slug"] != slug][:6]

    return render_template(
        "article.html",
        article={
            "slug": slug,
            "headline": article.get("headline", ""),
            "summary": article.get("summary", ""),
            "body": article.get("body", ""),
            "takeaway": article.get("takeaway", ""),
            "source": data.get("source", "ClearLens"),
            "source_url": data.get("sourceUrl", ""),
            "date_formatted": format_date(data.get("generatedAt", "")),
            "social": social,
            "research_sources": data.get("researchSources", []),
        },
        related_articles=related,
    )


@app.route("/desk", methods=["GET"])
def editorial_desk():
    articles = load_generated_articles(limit=100)
    for a in articles:
        a["date_formatted"] = format_date(a["generated_at"])

    return render_template(
        "desk.html",
        articles=articles,
        total_articles=len(articles),
        today=datetime.now().strftime("%B %d, %Y"),
    )


@app.route("/api/articles", methods=["GET"])
def api_articles():
    articles = load_generated_articles(limit=20)
    return jsonify(articles)


if __name__ == "__main__":
    init_web_tables()
    if app.config['ENV'] == 'production':
        app.run(debug=False, host="0.0.0.0", port=5000)
    else:
        app.run(debug=True, host="127.0.0.1", port=5000)
