import { NextResponse } from 'next/server';
import { ExperimentError, addDirection, addExperiment, readStore, removeExperiment, setDirectionActive, updateExperiment } from '@/lib/experiments/store';
import { experimentsView } from '@/lib/experiments/sunrise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = () => experimentsView(readStore(), new Date());
const answer = (extra: Record<string, unknown> = {}) => NextResponse.json({ success: true, data: view(), ...extra }, { headers: { 'Cache-Control': 'no-store' } });
const refuse = (e: unknown) => NextResponse.json(
  { success: false, error: e instanceof Error ? e.message : 'The experiment record could not be changed.' },
  { status: e instanceof ExperimentError ? e.status : 500 },
);

/** GET /api/experiments: the record, and the sky as Sunrise reads it. */
export async function GET() {
  try { return answer(); } catch (e) { return refuse(e); }
}

/**
 * POST /api/experiments: one change, then the record again.
 * {op: 'update', id, patch} · {op: 'create', experiment?} · {op: 'remove', id} · {op: 'direction', id, active: true | false | null} · {op: 'add-direction', name}
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    switch (body?.op) {
      case 'update': return answer({ experiment: updateExperiment(String(body.id), body.patch) });
      case 'create': return answer({ experiment: addExperiment(body.experiment, today) });
      case 'remove': removeExperiment(String(body.id)); return answer();
      case 'direction': {
        if (body.active !== null && typeof body.active !== 'boolean') throw new ExperimentError('Say whether the direction is on the sky: true, false, or null for "while it has recent work".');
        setDirectionActive(String(body.id), body.active);
        return answer();
      }
      case 'add-direction': return answer({ direction: addDirection({ name: body.name }) });
      default: throw new ExperimentError('Unknown change. Use update, create, remove, direction or add-direction.');
    }
  } catch (e) { return refuse(e); }
}
