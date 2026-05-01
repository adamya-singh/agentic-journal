import { NextRequest, NextResponse } from 'next/server';
import { readJobListings, writeJobListings } from '../job-store-utils';
import { isRecord, normalizeJobListingFields, UpdateJobListingFieldsSchema } from '../route-utils';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    if (!isRecord(rawBody)) {
      return NextResponse.json(
        { success: false, error: 'Request body must be an object' },
        { status: 400 }
      );
    }

    const { id, ...rawUpdates } = rawBody;

    if (typeof id !== 'string' || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const normalizedUpdates = normalizeJobListingFields(rawUpdates);
    const parsed = UpdateJobListingFieldsSchema.safeParse(normalizedUpdates);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid job listing update' },
        { status: 400 }
      );
    }

    const data = readJobListings();
    const listingIndex = data.listings.findIndex((listing) => listing.id === id.trim());

    if (listingIndex === -1) {
      return NextResponse.json(
        { success: false, error: 'Job listing not found' },
        { status: 404 }
      );
    }

    const currentListing = data.listings[listingIndex];
    const now = new Date().toISOString();
    const statusChanged = parsed.data.status !== undefined && parsed.data.status !== currentListing.status;

    const updatedListing = {
      ...currentListing,
      ...parsed.data,
      statusHistory: statusChanged
        ? [
            ...currentListing.statusHistory,
            {
              status: parsed.data.status!,
              changedAt: now,
            },
          ]
        : currentListing.statusHistory,
      updatedAt: now,
    };

    if (updatedListing.postedDate === undefined) {
      delete updatedListing.postedDate;
    }

    if (updatedListing.postedDateText === undefined) {
      delete updatedListing.postedDateText;
    }

    data.listings[listingIndex] = updatedListing;
    writeJobListings(data);

    return NextResponse.json({
      success: true,
      listing: updatedListing,
      listings: data.listings,
    });
  } catch (error) {
    console.error('Error updating job listing:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
