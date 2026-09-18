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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS uploaded_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL, source TEXT, article_date TEXT,
                url TEXT, content TEXT NOT NULL, attachment_name TEXT, created_at TEXT NOT NULL
            )
        """)
        try:
            conn.execute("ALTER TABLE uploaded_articles ADD COLUMN attachment_name TEXT")
        except sqlite3.OperationalError:
            pass
        conn.commit()


def format_date(iso_string):
    try:
        dt = datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
        return dt.strftime("%B %d, %Y")
    except Exception:
        return iso_string or ""


def load_generated_articles(limit=50):
    articles = []
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, title, source, article_date, url, content, created_at
            FROM uploaded_articles
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,)
        ).fetchall()

    for row in rows:
        content = row["content"] or ""
        lines = [l.strip() for l in content.split("\n") if l.strip()]
        summary = lines[2] if len(lines) > 2 else (lines[0] if lines else "")

        articles.append({
            "slug": str(row["id"]),
            "headline": row["title"] or "",
            "summary": summary,
            "body": content,
            "takeaway": "",
            "source": row["source"] or "ClearLens",
            "source_url": row["url"] or "",
            "image_url": "",
            "generated_at": row["created_at"] or "",
            "date_formatted": format_date(row["created_at"] or ""),
            "social": {},
            "consensus": {},
            "research_sources": [],
        })

    return articles


@app.route("/", methods=["GET"])
def public_home():
    articles = load_generated_articles(limit=50)
    featured = articles[0] if articles else None
    recent = articles[1:21] if len(articles) > 1 else []
    return render_template(
        "public_home.html",
        featured_article=featured,
        recent_articles=recent,
        total_articles=len(articles),
        today=datetime.now().strftime("%B %d, %Y"),
    )


@app.route("/article/<slug>", methods=["GET"])
def article_detail(slug):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, title, source, url, content, created_at FROM uploaded_articles WHERE id = ?",
            (slug,)
        ).fetchone()

    if row is None:
        abort(404)

    content = row["content"] or ""
    lines = [l.strip() for l in content.split("\n") if l.strip()]
    summary = lines[2] if len(lines) > 2 else (lines[0] if lines else "")

    all_articles = load_generated_articles(limit=20)
    related = [a for a in all_articles if a["slug"] != slug][:6]

    return render_template(
        "article.html",
        article={
            "slug": slug,
            "headline": row["title"] or "",
            "summary": summary,
            "body": content,
            "takeaway": "",
            "source": row["source"] or "ClearLens",
            "source_url": row["url"] or "",
            "image_url": "",
            "date_formatted": format_date(row["created_at"] or ""),
            "social": {},
            "consensus": {},
            "research_sources": [],
        },
        related_articles=related,
    )


@app.route("/desk", methods=["GET"])
def editorial_desk():
    articles = load_generated_articles(limit=100)
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
