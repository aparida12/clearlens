import { NextResponse } from "next/server";
import { writeArticles, writeStatus } from "@/lib/articleStore";

export const dynamic = "force-dynamic";

const RESET_STATUS = {
  lastRun: null,
  articlesGenerated: 0,
  topicsAnalyzed: 0,
  status: "idle",
  lastError: null,
};

export async function POST() {
  try {
    await writeArticles([]);
    await writeStatus(RESET_STATUS);

    return NextResponse.json({
      success: true,
      articles: [],
      status: RESET_STATUS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: String(error?.message || error),
      },
      { status: 500 },
    );
  }
}
