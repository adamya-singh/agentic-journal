import { NextResponse } from 'next/server';
import { ensureJobListingsFile } from '../job-store-utils';

export async function GET() {
  try {
    const data = ensureJobListingsFile();
    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error) {
    console.error('Error reading job listings:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
