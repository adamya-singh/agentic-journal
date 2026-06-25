import { NextRequest, NextResponse } from 'next/server';
import {
  getExpectedToken,
  getLocalDateString,
  isAuthorizedToken,
  isValidDate,
  readOmiAudioStatus,
} from '../audio-store-utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const expectedToken = getExpectedToken();

    if (!expectedToken) {
      return NextResponse.json(
        { success: false, error: 'Omi audio ingest token is not configured' },
        { status: 500 }
      );
    }

    if (!isAuthorizedToken(searchParams.get('token'))) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const date = searchParams.get('date') ?? getLocalDateString();
    if (!isValidDate(date)) {
      return NextResponse.json(
        { success: false, error: 'date must use YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      ...readOmiAudioStatus(date),
    });
  } catch (error) {
    console.error('Error reading Omi audio status:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
