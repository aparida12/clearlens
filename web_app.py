import os
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, render_template, request, url_for
from pypdf import PdfReader
from werkzeug.utils import secure_filename

from cross_researcher import CrossResearcher

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "processed_items.db"
UPLOADS_DIR = BASE_DIR / "uploads"
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".txt"}

app = Flask(__name__)

# Production vs Development configuration
app.config['ENV'] = os.getenv('FLASK_ENV', 'development')
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file upload


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_web_tables():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
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
            # Column already exists in previously initialized databases.
            pass
        conn.commit()


def extract_text_from_upload(file_path):
    if file_path.suffix.lower() == ".txt":
        return file_path.read_text(encoding="utf-8", errors="ignore")

    if file_path.suffix.lower() == ".pdf":
        reader = PdfReader(str(file_path))
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        return "\n".join(pages).strip()

    return ""


@app.route("/", methods=["GET"])
def public_home():
    """Public reader-facing homepage."""
    with get_conn() as conn:
        uploaded_articles = conn.execute(
            """
            SELECT id, title, source, article_date, url, content, attachment_name, created_at
            FROM uploaded_articles
            ORDER BY created_at DESC
            LIMIT 100
            """
        ).fetchall()

    featured_article = uploaded_articles[0] if uploaded_articles else None
    recent_articles = uploaded_articles[1:13] if len(uploaded_articles) > 1 else []

    return render_template(
        "public_home.html",
        featured_article=featured_article,
        recent_articles=recent_articles,
        total_articles=len(uploaded_articles),
        today=datetime.now().strftime("%B %d, %Y"),
    )


@app.route("/desk", methods=["GET"])
def editorial_desk():
    """Editorial submission desk for uploading articles."""
    with get_conn() as conn:
        processed_items = conn.execute(
            """
            SELECT title, source, date
            FROM processed
            ORDER BY date DESC
            LIMIT 200
            """
        ).fetchall()

        uploaded_articles = conn.execute(
            """
            SELECT id, title, source, article_date, url, content, attachment_name, created_at
            FROM uploaded_articles
            ORDER BY created_at DESC
            LIMIT 200
            """
        ).fetchall()

    uploaded_count = len(uploaded_articles)
    processed_count = len(processed_items)

    featured_article = uploaded_articles[0] if uploaded_articles else None
    journal_articles = uploaded_articles[1:9] if uploaded_count > 1 else []
    monitor_briefs = processed_items[:12]

    return render_template(
        "desk.html",
        processed_items=processed_items,
        uploaded_articles=uploaded_articles,
        uploaded_count=uploaded_count,
        processed_count=processed_count,
        featured_article=featured_article,
        journal_articles=journal_articles,
        monitor_briefs=monitor_briefs,
        today=datetime.now().strftime("%B %d, %Y"),
    )


@app.route("/article/<int:article_id>", methods=["GET"])
def article_detail(article_id):
    with get_conn() as conn:
        article = conn.execute(
            """
            SELECT id, title, source, article_date, url, content, attachment_name, created_at
            FROM uploaded_articles
            WHERE id = ?
            """,
            (article_id,),
        ).fetchone()

        related_articles = conn.execute(
            """
            SELECT id, title, source, article_date, created_at
            FROM uploaded_articles
            WHERE id != ?
            ORDER BY created_at DESC
            LIMIT 8
            """,
            (article_id,),
        ).fetchall()

    if article is None:
        abort(404)

    return render_template(
        "article.html",
        article=article,
        related_articles=related_articles,
    )


@app.route("/research/<int:article_id>", methods=["GET"])
def research_article(article_id):
    """Display cross-research results for an article."""
    with get_conn() as conn:
        research = conn.execute(
            """
            SELECT id, original_title, original_source, original_date, research_date,
                   keywords, reliability_score, total_sources_found, research_data, article_content
            FROM cross_research
            WHERE id = ?
            """,
            (article_id,),
        ).fetchone()

    if research is None:
        abort(404)

    research_data = {}
    try:
        import json

        research_data = json.loads(research["research_data"])
    except:
        pass

    return render_template(
        "research.html",
        research=research,
        research_data=research_data,
    )


@app.route("/api/cross-research/<int:article_id>", methods=["POST"])
def api_cross_research(article_id):
    """API endpoint to trigger cross-research on an article."""
    depth = request.json.get("depth", "medium") if request.json else "medium"

    with get_conn() as conn:
        article = conn.execute(
            """
            SELECT id, title, source, article_date, url, content
            FROM uploaded_articles
            WHERE id = ?
            """,
            (article_id,),
        ).fetchone()

    if article is None:
        return jsonify({"error": "Article not found"}), 404

    try:
        import json

        researcher = CrossResearcher(ncbi_api_key=os.getenv("NCBI_API_KEY"))

        # Prepare item for research
        item = {
            "title": article["title"],
            "text": article["content"][:2000],  # First 2000 chars for research
            "source": article["source"] or "Editorial",
            "date": article["article_date"] or article["id"],
            "url": article["url"] or "",
        }

        # Run cross-research
        research_report = researcher.cross_research_finding(item, depth=depth)
        research_article = researcher.generate_research_article(item, research_report)

        # Save to database
        with get_conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cross_research (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    article_id INTEGER,
                    original_title TEXT NOT NULL,
                    original_source TEXT,
                    original_date TEXT,
                    research_date TEXT NOT NULL,
                    keywords TEXT,
                    reliability_score TEXT,
                    total_sources_found INTEGER,
                    research_data TEXT NOT NULL,
                    article_content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(article_id) REFERENCES uploaded_articles(id)
                )
                """
            )

            cursor = conn.execute(
                """
                INSERT INTO cross_research 
                (article_id, original_title, original_source, original_date, research_date, keywords, 
                 reliability_score, total_sources_found, research_data, article_content, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    article_id,
                    item["title"],
                    item["source"],
                    item["date"],
                    research_report["research_date"],
                    ",".join(research_report["keywords"]),
                    research_report["metadata"]["reliability_score"],
                    research_report["metadata"]["total_sources_found"],
                    json.dumps(research_report),
                    research_article,
                    datetime.utcnow().isoformat(timespec="seconds"),
                ),
            )
            conn.commit()
            research_id = cursor.lastrowid

        return jsonify(
            {
                "success": True,
                "research_id": research_id,
                "sources_found": research_report["metadata"]["total_sources_found"],
                "reliability": research_report["metadata"]["reliability_score"],
            }
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload", methods=["POST"])
def upload_article():
    title = request.form.get("title", "").strip()
    source = request.form.get("source", "").strip()
    article_date = request.form.get("article_date", "").strip()
    url = request.form.get("url", "").strip()
    content = request.form.get("content", "").strip()
    upload = request.files.get("article_file")

    attachment_name = ""

    if upload and upload.filename:
        safe_name = secure_filename(upload.filename)
        extension = Path(safe_name).suffix.lower()
        if extension in ALLOWED_UPLOAD_EXTENSIONS:
            timestamp_prefix = datetime.utcnow().strftime("%Y%m%d%H%M%S")
            saved_name = f"{timestamp_prefix}_{safe_name}"
            saved_path = UPLOADS_DIR / saved_name
            upload.save(saved_path)
            attachment_name = safe_name

            extracted = extract_text_from_upload(saved_path)
            if extracted:
                content = extracted

            if not title:
                title = Path(safe_name).stem.replace("_", " ").strip() or "Uploaded Article"

    if not title or not content:
        return redirect(url_for("editorial_desk"))

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO uploaded_articles (title, source, article_date, url, content, attachment_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                source,
                article_date,
                url,
                content,
                attachment_name,
                datetime.utcnow().isoformat(timespec="seconds"),
            ),
        )
        conn.commit()

    return redirect(url_for("editorial_desk"))


if __name__ == "__main__":
    init_web_tables()
    # Development server only - use gunicorn in production
    if app.config['ENV'] == 'production':
        app.run(debug=False, host="0.0.0.0", port=5000)
    else:
        app.run(debug=True, host="127.0.0.1", port=5000)
