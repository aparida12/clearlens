import { NextResponse } from 'next/server';
import { runAgentCycle } from '@/lib/agent';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const isTest = searchParams.get('test') === 'true';
    const runResult = await runAgentCycle({ baseUrl: new URL(request.url).origin, test: isTest });

    return NextResponse.json(runResult, { status: runResult?.success === false ? 500 : 200 });
  } catch (error) {
    const response = {
      success: false,
      error: String(error?.message || error),
    };
    
    // Include debug info in test mode
    if (new URL(request.url).searchParams.get('test') === 'true' && error?.debugInfo) {
      response.debugInfo = error.debugInfo;
    }
    
    return NextResponse.json(response, { status: 500 });
  }
}
