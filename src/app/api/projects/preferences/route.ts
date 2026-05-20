import { NextRequest, NextResponse } from 'next/server';
import { normalizeProjectSlug } from '@/lib/projects';
import { readProjectPreferences, setProjectPinned } from '../preferences-store-utils';

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

function normalizeProjectOrError(value: unknown): { project: string } | { error: string } {
  if (typeof value !== 'string') {
    return { error: 'project is required' };
  }

  const project = normalizeProjectSlug(value);
  if (project.length === 0 || project === '__unassigned__') {
    return { error: 'Invalid project' };
  }

  return { project };
}

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      preferences: readProjectPreferences(),
    });
  } catch (error) {
    console.error('Error reading project preferences:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action !== 'set-pinned') {
      return badRequest('Invalid action');
    }

    const normalized = normalizeProjectOrError(body.project);
    if ('error' in normalized) {
      return badRequest(normalized.error);
    }

    if (typeof body.pinned !== 'boolean') {
      return badRequest('pinned must be a boolean');
    }

    return NextResponse.json({
      success: true,
      preferences: setProjectPinned(normalized.project, body.pinned),
    });
  } catch (error) {
    console.error('Error updating project preferences:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
