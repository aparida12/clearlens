import { NextResponse } from "next/server";
import { getAgentArticles } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "All";
    const limit = searchParams.get("limit") || "";
    const articles = await getAgentArticles({ category, limit });

    return NextResponse.json(
      { articles },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        articles: [],
        error: String(error?.message || error),
      },
      { status: 500 },
    );
  }
}
