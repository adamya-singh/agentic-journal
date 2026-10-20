import { NextRequest, NextResponse } from 'next/server';
import {
  mutateJobApplicationsStore,
  readJobApplicationsStore,
  releaseApplicationsAnsweredByBank,
  setAnswerScope,
} from '../../application-store-utils';
import { wakeJobApplicationWorkerIfEnabled } from '../../application-worker-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = readJobApplicationsStore();
    return NextResponse.json({ success: true, entries: store.answerBank });
  } catch (error) {
    console.error('Error reading answer bank:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: unknown;
      id?: unknown;
      answer?: unknown;
      scope?: unknown;
    };
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    if (body.action === 'delete') {
      const removed = await mutateJobApplicationsStore((store) => {
        const index = store.answerBank.findIndex((entry) => entry.id === id);
        if (index < 0) {
          return false;
        }
        store.answerBank.splice(index, 1);
        return true;
      });
      if (!removed) {
        return NextResponse.json({ success: false, error: 'Entry not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, removed: true });
    }

    if (body.action === 'update') {
      const answer = body.answer;
      const validAnswer =
        (typeof answer === 'string' && answer.trim().length > 0) ||
        (Array.isArray(answer) &&
          answer.length > 0 &&
          answer.every((item) => typeof item === 'string' && item.trim().length > 0));
      if (!validAnswer) {
        return NextResponse.json(
          { success: false, error: 'answer must be a non-empty string or string array' },
          { status: 400 },
        );
      }
      // Hand-editing a file reference would bypass upload validation.
      const existing = readJobApplicationsStore().answerBank.find((entry) => entry.id === id);
      if (existing?.kind === 'file') {
        return NextResponse.json(
          { success: false, error: 'File answers can only be replaced by uploading in an application' },
          { status: 400 },
        );
      }

      const updated = await mutateJobApplicationsStore((store) => {
        const entry = store.answerBank.find((candidate) => candidate.id === id);
        if (!entry) {
          return null;
        }
        entry.answer = answer as string | string[];
        entry.confirmedAt = new Date().toISOString();
        return entry;
      });
      if (!updated) {
        return NextResponse.json({ success: false, error: 'Entry not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, entry: updated });
    }

    if (body.action === 'scope') {
      const scope = body.scope;
      if (scope !== 'general' && scope !== 'context') {
        return NextResponse.json({ success: false, error: 'scope must be general or context' }, { status: 400 });
      }
      const result = await mutateJobApplicationsStore((store) => {
        const entry = setAnswerScope(store, id, scope);
        if (!entry) return null;
        // An answer that now applies everywhere can settle questions other applications wait on.
        const released = scope === 'general' ? releaseApplicationsAnsweredByBank(store, new Date().toISOString()) : [];
        return { entry: { ...entry }, released };
      });
      if (!result) {
        return NextResponse.json({ success: false, error: 'Entry not found' }, { status: 404 });
      }
      if (result.released.length > 0) await wakeJobApplicationWorkerIfEnabled();
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json(
      { success: false, error: 'action must be update, scope or delete' },
      { status: 400 },
    );
  } catch (error) {
    console.error('Error mutating answer bank:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
