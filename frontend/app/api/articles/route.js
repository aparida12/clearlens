import Database from "better-sqlite3";
import path from "path";
import { NextResponse } from "next/server";

export async function GET() {
  let db;

  try {
    const dbPath = path.resolve(process.cwd(), "..", "processed_items.db");
    db = new Database(dbPath, { readonly: true });

    const rows = db
      .prepare(
        `
        SELECT
          id,
          title,
          source,
          article_date,
          content,
          created_at
        FROM uploaded_articles
        WHERE status = 'approved'
        ORDER BY datetime(created_at) DESC
        LIMIT 20
        `,
      )
      .all();

    return NextResponse.json({ articles: rows });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load articles",
        details: String(error?.message || error),
      },
      { status: 500 },
    );
  } finally {
    if (db) {
      db.close();
    }
  }
}
