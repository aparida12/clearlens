import { NextResponse } from "next/server";
import { getAgentStatus } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getAgentStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        lastRun: null,
        articlesGenerated: 0,
        topicsAnalyzed: 0,
        status: "error",
        currentStep: null,
        lastError: String(error?.message || error),
      },
      { status: 500 },
    );
  }
}
