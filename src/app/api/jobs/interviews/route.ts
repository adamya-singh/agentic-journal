import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorized } from '@/app/api/bugs-features/route-utils';
import { readJobListings } from '../job-store-utils';
import { readJobApplicationsStore } from '../application-store-utils';
import { readExtras } from '../overview/store';
import { mutateInterviews, readInterviews } from '@/lib/interviews/store';
import { buildCasebook } from '@/lib/interviews/view';
import { addPerson, NOTE_KINDS, resolveFlag, saveNote, setDomain, setRound } from '@/lib/interviews/actions';
import type { NoteKind } from '@/lib/interviews/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const source = () => ({ listings: readJobListings().listings, applications: readJobApplicationsStore().applications });

export async function GET() {
  try {
    const { listings, applications } = source();
    return NextResponse.json({
      success: true,
      data: buildCasebook({ index: readInterviews(), listings, applications, milestones: readExtras().milestones }),
    });
  } catch (error) {
    console.error('Unable to read the interviews casebook:', error);
    return NextResponse.json({ success: false, error: 'Unable to read the casebook' }, { status: 500 });
  }
}

const Key = z.string().min(1).max(200);
const ActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save-note'), process: Key, noteId: z.string().max(200).optional(), title: z.string().trim().max(200).optional(),
    kind: z.enum(NOTE_KINDS as [NoteKind, ...NoteKind[]]).optional(), round: z.string().max(200).optional(), body: z.string().max(400_000),
  }),
  z.object({
    action: z.literal('set-round'), process: Key, id: z.string().min(1).max(200), name: z.string().trim().max(120).optional(),
    at: z.string().datetime({ offset: true }).optional(), time: z.string().max(60).optional(), duration: z.string().max(60).optional(),
    people: z.array(z.string().trim().min(1).max(120)).max(12).optional(), format: z.string().max(200).optional(), note: z.string().max(1000).optional(),
  }),
  z.object({ action: z.literal('add-person'), process: Key, name: z.string().trim().min(2).max(120), role: z.string().trim().max(120).optional(), email: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal('resolve-flag'), process: Key, flagId: z.string().min(1), option: z.string().min(1) }),
  z.object({ action: z.literal('set-domain'), company: z.string().trim().min(1).max(200), domain: z.string().trim().min(3).max(253) }),
]);

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: 'A same-origin request is required.' }, { status: 403 });
  let input: z.infer<typeof ActionSchema>;
  try {
    input = ActionSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message : 'Invalid request';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
  try {
    const src = source();
    const data = await mutateInterviews((index) => {
      switch (input.action) {
        case 'save-note': {
          const note = saveNote(index, { key: input.process, noteId: input.noteId, title: input.title, kind: input.kind, round: input.round, body: input.body, author: 'you' }, src);
          const process = index.processes.find((p) => p.notes.includes(note))!;
          return { processId: process.id, note: { id: note.id, bytes: note.bytes } };
        }
        case 'set-round': {
          const { process, ...rest } = input;
          const { action, ...round } = rest;
          void action;
          return { round: setRound(index, process, round, src) };
        }
        case 'add-person':
          addPerson(index, input.process, { name: input.name, role: input.role, email: input.email }, src);
          return { ok: true };
        case 'resolve-flag':
          resolveFlag(index, input.process, input.flagId, input.option);
          return { ok: true };
        case 'set-domain':
          return { domain: setDomain(index, input.company, input.domain) };
      }
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'That did not save' }, { status: 400 });
  }
}
