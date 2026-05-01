import { NextRequest, NextResponse } from 'next/server';
import { readJobListings, writeJobListings } from '../job-store-utils';
import { isRecord } from '../route-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json(
        { success: false, error: 'Request body must be an object' },
        { status: 400 }
      );
    }

    const id = typeof body.id === 'string' ? body.id.trim() : '';

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const data = readJobListings();
    const initialCount = data.listings.length;
    data.listings = data.listings.filter((listing) => listing.id !== id);

    if (data.listings.length === initialCount) {
      return NextResponse.json(
        { success: false, error: 'Job listing not found' },
        { status: 404 }
      );
    }

    writeJobListings(data);

    return NextResponse.json({
      success: true,
      listings: data.listings,
    });
  } catch (error) {
    console.error('Error removing job listing:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
