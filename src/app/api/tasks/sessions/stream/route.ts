import { NextRequest } from 'next/server';
import { parseAfter, subscribeTask } from '@/lib/code-agents/hub';
import type { SessionEvent } from '@/lib/code-agents/protocol';
import { fromThisAppStrict } from '@/lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The live events of one task's coding sessions, as server-sent events: the Journal's first live stream. Each
// event is one SessionEvent (lib/code-agents/protocol.ts) as `event: session`, with `id: <session>:<seq>`.
// A client that saw some already says where it is (`after`), and gets what it missed first, or a `reset` for a
// session whose place the server no longer has (then it reads that session's history again).

const HEARTBEAT_MS = 15_000;

/**
 * GET /api/tasks/sessions/stream?id=<taskId>[&after=<session>:<seq>,<session>:<seq>]
 * An EventSource that reconnects by itself sends Last-Event-ID; that session's place counts too.
 */
export async function GET(request: NextRequest) {
  if (!fromThisAppStrict(request.headers)) {
    return new Response(JSON.stringify({ success: false, error: 'Only the Journal’s own pages may reach coding sessions.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const params = request.nextUrl.searchParams;
  const taskId = params.get('id');
  if (!taskId) return new Response(JSON.stringify({ success: false, error: 'Missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const after = parseAfter(params.get('after'));
  for (const [session, seq] of parseAfter(request.headers.get('last-event-id'))) {
    if (!after.has(session) || after.get(session)! < seq) after.set(session, seq);
  }

  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let close = () => { open = false; };
      const write = (chunk: string) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { close(); }
      };
      const send = (event: SessionEvent) => write(`id: ${event.session}:${event.seq}\nevent: session\ndata: ${JSON.stringify(event)}\n\n`);
      // Something at once, so every proxy on the way passes the stream on from the start.
      write(`retry: 3000\n: open\n\n`);
      const unsubscribe = subscribeTask(taskId, after, send);
      const beat = setInterval(() => write(`: beat ${Date.now()}\n\n`), HEARTBEAT_MS);
      close = () => {
        if (!open) return;
        open = false;
        clearInterval(beat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      stop = close;
      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() { stop(); },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform keeps `next start`'s compression (and any proxy) from holding events back to compress them.
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
