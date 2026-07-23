import { NextResponse } from 'next/server';
import { buildJobApplicationsView } from '../../application-store-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ success: true, ...buildJobApplicationsView() });
  } catch (error) {
    console.error('Error reading job applications:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read job applications' },
      { status: 500 },
    );
  }
}
