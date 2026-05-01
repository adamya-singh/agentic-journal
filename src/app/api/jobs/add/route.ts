import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { JobListing } from '@/lib/types';
import { readJobListings, writeJobListings } from '../job-store-utils';
import { isRecord, JobListingFieldsSchema, normalizeJobListingFields } from '../route-utils';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    if (!isRecord(rawBody)) {
      return NextResponse.json(
        { success: false, error: 'Request body must be an object' },
        { status: 400 }
      );
    }

    const normalizedBody = normalizeJobListingFields(rawBody);
    const parsed = JobListingFieldsSchema.safeParse(normalizedBody);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid job listing' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const listing: JobListing = {
      id: randomUUID(),
      company: parsed.data.company,
      companySummary: parsed.data.companySummary,
      positionTitle: parsed.data.positionTitle,
      location: parsed.data.location,
      jobType: parsed.data.jobType,
      status: parsed.data.status,
      salary: parsed.data.salary,
      link: parsed.data.link,
      source: parsed.data.source,
      notes: parsed.data.notes ?? '',
      postedDate: parsed.data.postedDate,
      postedDateText: parsed.data.postedDateText,
      savedAt: now,
      statusHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    const data = readJobListings();
    data.listings.unshift(listing);
    writeJobListings(data);

    return NextResponse.json({
      success: true,
      listing,
      listings: data.listings,
    });
  } catch (error) {
    console.error('Error adding job listing:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
