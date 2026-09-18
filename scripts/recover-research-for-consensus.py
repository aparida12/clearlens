import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from cross_researcher import CrossResearcher

DB_FILE = ROOT / "processed_items.db"
REPORT_FILE = ROOT / "frontend" / "research-source-recovery-dry-run.json"
TARGET_IDS = list(range(3, 21))


def load_env_file():
    for file_path in (ROOT / ".env", ROOT / ".env.local"):
        if not file_path.exists():
            continue
        for line in file_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))
        break


def main():
    load_env_file()
    with sqlite3.connect(DB_FILE) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, title, source, article_date, url, content FROM uploaded_articles WHERE id IN (%s) ORDER BY id"
            % ",".join("?" for _ in TARGET_IDS),
            TARGET_IDS,
        ).fetchall()

    ncbi_key = os.getenv("NCBI_API_KEY", "").strip()
    if not ncbi_key or ncbi_key.lower().startswith(("your_", "replace", "none")):
        ncbi_key = None
    researcher = CrossResearcher(ncbi_api_key=ncbi_key)
    results = []
    for index, row in enumerate(rows, start=1):
        item = {
            "title": row["title"],
            "source": row["source"],
            "date": row["article_date"],
            "url": row["url"],
            "text": row["content"],
        }
        print(f"[{index}/{len(rows)}] Recovering sources for record {row['id']}: {row['title']}", flush=True)
        try:
            report = researcher.cross_research_finding(item, depth="exhaustive")
            findings = report.get("findings", {})
            source_records = [
                *findings.get("corroborating_studies", []),
                *findings.get("related_news", []),
                *findings.get("complementary_research", []),
            ]
            results.append({
                "id": row["id"],
                "title": row["title"],
                "status": "recovered" if len(source_records) >= 3 else "hold",
                "sourceCount": len(source_records),
                "research": report,
                "reason": None if len(source_records) >= 3 else "Fewer than 3 sources recovered.",
            })
            print(f"  recovered {len(source_records)} sources", flush=True)
        except Exception as error:
            results.append({
                "id": row["id"],
                "title": row["title"],
                "status": "failed",
                "sourceCount": 0,
                "research": None,
                "reason": str(error),
            })
            print(f"  failed: {error}", flush=True)

    report = {
        "mode": "SOURCE RECOVERY DRY RUN - NO ARTICLE OR DATABASE WRITES",
        "sourceModule": "cross_researcher.CrossResearcher.cross_research_finding",
        "researchDepth": "exhaustive",
        "targetIds": TARGET_IDS,
        "summary": {
            "requested": len(TARGET_IDS),
            "recovered": sum(result["status"] == "recovered" for result in results),
            "held": sum(result["status"] == "hold" for result in results),
            "failed": sum(result["status"] == "failed" for result in results),
            "totalSources": sum(result["sourceCount"] for result in results),
        },
        "records": results,
    }
    REPORT_FILE.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(REPORT_FILE), **report["summary"]}, indent=2))


if __name__ == "__main__":
    main()
