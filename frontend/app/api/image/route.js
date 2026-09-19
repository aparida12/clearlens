import { NextResponse } from "next/server";
import { fetchArticleImage } from "@/lib/fetchImage";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const topic = String(searchParams.get("topic") || "").trim();
  const section = String(searchParams.get("section") || "").trim();

  if (!topic && !section) {
    return NextResponse.json({ image: null }, { status: 200 });
  }

  const image = await fetchArticleImage(topic, section);
  return NextResponse.json({ image }, { status: 200 });
}
