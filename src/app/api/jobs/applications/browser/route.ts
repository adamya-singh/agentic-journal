import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  answerFileChooser,
  captureBrowserFrame,
  endManualBrowserSession,
  openBrowserTab,
  OpenClawBrowserError,
  sendBrowserInput,
  touchManualBrowserSession,
} from '@/lib/openclaw-browser';
import { readJobListings } from '../../job-store-utils';
import {
  getJobApplicationReadiness,
  JOB_APPLICATION_RESUME_FILES,
  readJobApplicationsStore,
} from '../../application-store-utils';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const InputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: z.number(), y: z.number() }),
  z.object({ type: z.literal('scroll'), x: z.number(), y: z.number(), deltaY: z.number() }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(5000) }),
  z.object({
    type: z.literal('key'), key: z.string().min(1).max(20),
    ctrl: z.boolean().optional(), shift: z.boolean().optional(), alt: z.boolean().optional(), meta: z.boolean().optional(),
  }),
  z.object({ type: z.literal('navigate'), url: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('reload') }),
]);

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), listingId: z.string().min(1) }),
  z.object({ action: z.literal('input'), targetId: z.string().min(1), input: InputSchema }),
  z.object({ action: z.literal('end') }),
  // Answer a file picker with a saved resume, or dismiss it.
  z.object({ action: z.literal('file'), targetId: z.string().min(1), choice: z.enum(['swe', 'mle', 'cancel']) }),
]);

/** The live picture of one tab, with what the viewer needs to map clicks back onto it. */
export async function GET(request: NextRequest) {
  const targetId = request.nextUrl.searchParams.get('targetId');
  if (!targetId) return NextResponse.json({ success: false, error: 'targetId is required' }, { status: 400 });
  try {
    touchManualBrowserSession();
    const frame = await captureBrowserFrame(targetId);
    return new NextResponse(new Uint8Array(frame.jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Page-Url': encodeURIComponent(frame.url),
        'X-Page-Title': encodeURIComponent(frame.title),
        'X-Viewport-Width': String(frame.width),
        'X-Viewport-Height': String(frame.height),
        ...(frame.fileChooser ? { 'X-File-Chooser': frame.fileChooser } : {}),
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      return await uploadToFileChooser(request);
    }
    const parsed = ActionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid browser action' },
        { status: 400 },
      );
    }
    const input = parsed.data;
    if (input.action === 'end') {
      endManualBrowserSession();
      return NextResponse.json({ success: true });
    }
    touchManualBrowserSession();
    if (input.action === 'file') {
      const resumeDirectory = getJobApplicationReadiness().resumeDirectory;
      await answerFileChooser(
        input.targetId,
        input.choice === 'cancel' ? [] : [path.join(resumeDirectory, JOB_APPLICATION_RESUME_FILES[input.choice])],
      );
      return NextResponse.json({ success: true });
    }
    if (input.action === 'input') {
      await sendBrowserInput(input.targetId, input.input);
      return NextResponse.json({ success: true });
    }

    const store = readJobApplicationsStore();
    const application = store.applications[input.listingId];
    const listing = readJobListings().listings.find((candidate) => candidate.id === input.listingId);
    if (!listing) return NextResponse.json({ success: false, error: 'Job posting not found' }, { status: 404 });
    // Where the worker got stuck first, newest first; then the application itself.
    const stuckOn = (application?.questions ?? [])
      .filter((question) => question.resolution === 'pending' && question.pageUrl)
      .sort((first, second) => second.discoveredAt.localeCompare(first.discoveredAt))
      .map((question) => question.pageUrl!);
    const targetId = await openBrowserTab([
      ...stuckOn,
      application?.canonicalApplicationUrl ?? '',
      listing.link,
    ]);
    const now = Date.now();
    const running = Object.values(store.applications).find(
      (candidate) => candidate.lease && Date.parse(candidate.lease.expiresAt) > now,
    );
    const runningListing = running && readJobListings().listings.find((candidate) => candidate.id === running.listingId);
    return NextResponse.json({
      success: true,
      targetId,
      ...(running && running.listingId !== input.listingId
        ? { workerBusyWith: runningListing?.company ?? 'another application' }
        : {}),
    });
  } catch (error) {
    return failure(error);
  }
}

/** A file from Adamya's device, staged on this machine where Chrome can read it. */
async function uploadToFileChooser(request: NextRequest) {
  touchManualBrowserSession();
  const form = await request.formData();
  const targetId = form.get('targetId');
  const file = form.get('file');
  if (typeof targetId !== 'string' || !targetId || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'Choose a file to upload' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, error: 'Files over 20 MB are not supported' }, { status: 413 });
  }
  const directory = path.join(tmpdir(), 'agentic-journal-browser-uploads', randomUUID());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = path.basename(file.name).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'upload';
  const destination = path.join(directory, name);
  writeFileSync(destination, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  await answerFileChooser(targetId, [destination]);
  return NextResponse.json({ success: true });
}

function failure(error: unknown) {
  const known = error instanceof OpenClawBrowserError;
  if (!known) console.error('OpenClaw browser bridge failed:', error);
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : 'OpenClaw browser request failed' },
    { status: known ? 502 : 500 },
  );
}
