import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const DATA_DIR = path.resolve(process.cwd(), "data");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const STATUS_FILE = path.join(DATA_DIR, "agent-status.json");
const RESET_ARTICLES = "[]";
const RESET_STATUS = '{"lastRun":null,"articlesGenerated":0,"topicsAnalyzed":0,"status":"idle","lastError":null}';

async function writeIfDifferent(filePath, expectedContent) {
  try {
    const current = await fs.readFile(filePath, "utf8");
    if (String(current).trim() === expectedContent) {
      return false;
    }
  } catch {
    // Missing file or unreadable file should be overwritten with reset content.
  }

  await fs.writeFile(filePath, expectedContent, "utf8");
  return true;
}

export async function POST() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeIfDifferent(ARTICLES_FILE, RESET_ARTICLES);
    await writeIfDifferent(STATUS_FILE, RESET_STATUS);
    return NextResponse.json({ success: true, message: "All articles deleted" });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
