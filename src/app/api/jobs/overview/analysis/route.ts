import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from './service';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json({
      success: true,
      report: await generateAnalysis(body.force === true),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'Analysis could not complete or is already running. The previous report is retained.',
      },
      { status: 503 },
    );
  }
}
