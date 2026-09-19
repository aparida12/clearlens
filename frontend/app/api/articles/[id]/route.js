import Database from "better-sqlite3";
import path from "path";
import { NextResponse } from "next/server";

export async function GET(_request, { params }) {
  let db;

  try {
    const id = Number(params?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const dbPath = path.resolve(process.cwd(), "..", "processed_items.db");
    db = new Database(dbPath, { readonly: true });

    const article = db
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
        WHERE id = ? AND status = 'approved'
        LIMIT 1
        `,
      )
      .get(id);

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    return NextResponse.json({ article });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load article",
        details: String(error?.message || error),
      },
      { status: 500 },
    );
  } finally {
    if (db) db.close();
  }
}
