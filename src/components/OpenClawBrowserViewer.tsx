'use client';

/* eslint-disable @next/next/no-img-element -- live frames are private blob URLs */

import React from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Keyboard, Loader2, RotateCw, Send, X } from 'lucide-react';

type BrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'reload' };

interface Frame {
  src: string;
  url: string;
  title: string;
  width: number;
  height: number;
}

const FRAME_INTERVAL_MS = 700;
const FORWARDED_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
]);

/**
 * OpenClaw's own Chrome, live, inside the Journal: solve the CAPTCHA, sign in,
 * or finish the form where the worker stopped, then hand the application back.
 */
export function OpenClawBrowserViewer({
  listingId,
  heading,
  task,
  onHandBack,
  onSubmittedByHand,
  onClose,
}: {
  listingId: string;
  heading: string;
  task?: string;
  onHandBack: () => Promise<void>;
  onSubmittedByHand: () => Promise<void>;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [frame, setFrame] = React.useState<Frame | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [workerBusyWith, setWorkerBusyWith] = React.useState<string | null>(null);
  const [address, setAddress] = React.useState('');
  const [editingAddress, setEditingAddress] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [finishing, setFinishing] = React.useState<'hand-back' | 'submitted' | null>(null);
  const kickRef = React.useRef<() => void>(() => undefined);
  const screenRef = React.useRef<HTMLDivElement>(null);
  const wheelRef = React.useRef({ deltaY: 0, x: 0, y: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/jobs/applications/browser', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'open', listingId }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Could not open OpenClaw’s browser');
        if (cancelled) return;
        setTargetId(data.targetId);
        setWorkerBusyWith(data.workerBusyWith ?? null);
      } catch (openError) {
        if (!cancelled) setError(openError instanceof Error ? openError.message : 'Could not open OpenClaw’s browser');
      }
    })();
    return () => {
      cancelled = true;
      // Let the worker have its browser back.
      void fetch('/api/jobs/applications/browser', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'end' }), keepalive: true,
      }).catch(() => undefined);
    };
  }, [listingId]);

  // Poll frames while open; an input wakes the loop early.
  React.useEffect(() => {
    if (!targetId) return;
    let stopped = false;
    let wake: () => void = () => undefined;
    kickRef.current = () => wake();
    const loop = async () => {
      while (!stopped) {
        if (document.visibilityState === 'visible') {
          try {
            const response = await fetch(`/api/jobs/applications/browser?targetId=${encodeURIComponent(targetId)}`, { cache: 'no-store' });
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(data.error || 'Lost the browser picture');
            }
            const blob = await response.blob();
            const next: Frame = {
              src: URL.createObjectURL(blob),
              url: decodeURIComponent(response.headers.get('X-Page-Url') ?? ''),
              title: decodeURIComponent(response.headers.get('X-Page-Title') ?? ''),
              width: Number(response.headers.get('X-Viewport-Width')) || 1,
              height: Number(response.headers.get('X-Viewport-Height')) || 1,
            };
            if (stopped) {
              URL.revokeObjectURL(next.src);
              return;
            }
            setFrame((previous) => {
              if (previous) URL.revokeObjectURL(previous.src);
              return next;
            });
            setError(null);
          } catch (frameError) {
            setError(frameError instanceof Error ? frameError.message : 'Lost the browser picture');
          }
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, FRAME_INTERVAL_MS);
          wake = () => { clearTimeout(timer); resolve(); };
        });
      }
    };
    void loop();
    return () => { stopped = true; wake(); };
  }, [targetId]);

  React.useEffect(() => {
    if (frame && !editingAddress) setAddress(frame.url);
  }, [frame, editingAddress]);

  const frameSrcRef = React.useRef<string | null>(null);
  frameSrcRef.current = frame?.src ?? null;
  React.useEffect(() => () => {
    if (frameSrcRef.current) URL.revokeObjectURL(frameSrcRef.current);
  }, []);

  const send = React.useCallback(async (input: BrowserInput) => {
    if (!targetId) return;
    try {
      const response = await fetch('/api/jobs/applications/browser', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'input', targetId, input }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'That did not reach the browser');
    } catch (inputError) {
      setError(inputError instanceof Error ? inputError.message : 'That did not reach the browser');
    }
    // Pages take a moment to react.
    setTimeout(() => kickRef.current(), 150);
  }, [targetId]);

  const pagePoint = (clientX: number, clientY: number) => {
    const image = screenRef.current?.querySelector('img');
    if (!image || !frame) return null;
    const rect = image.getBoundingClientRect();
    return {
      x: Math.round(((clientX - rect.left) / rect.width) * frame.width),
      y: Math.round(((clientY - rect.top) / rect.height) * frame.height),
    };
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const command = event.ctrlKey || event.metaKey;
    // Paste arrives as a paste event with the text.
    if (command && event.key.toLowerCase() === 'v') return;
    if (command && /^[a-z]$/i.test(event.key)) {
      event.preventDefault();
      void send({ type: 'key', key: event.key.toLowerCase(), ctrl: true, shift: event.shiftKey });
    } else if (FORWARDED_KEYS.has(event.key)) {
      event.preventDefault();
      void send({ type: 'key', key: event.key, shift: event.shiftKey });
    } else if (event.key.length === 1 && !command && !event.altKey) {
      event.preventDefault();
      void send({ type: 'text', text: event.key });
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    const point = pagePoint(event.clientX, event.clientY);
    if (!point) return;
    const wheel = wheelRef.current;
    wheel.deltaY += event.deltaY;
    wheel.x = point.x;
    wheel.y = point.y;
    if (wheel.timer) return;
    wheel.timer = setTimeout(() => {
      void send({ type: 'scroll', x: wheel.x, y: wheel.y, deltaY: wheel.deltaY });
      wheel.deltaY = 0;
      wheel.timer = 0;
    }, 80);
  };

  const finish = async (mode: 'hand-back' | 'submitted') => {
    setFinishing(mode);
    setError(null);
    try {
      await (mode === 'submitted' ? onSubmittedByHand() : onHandBack());
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : 'Could not save that');
      setFinishing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-slate-100" role="dialog" aria-modal="true" aria-label="OpenClaw’s browser">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{heading}</p>
          {task && <p className="truncate text-xs text-slate-400">{task}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800"
          aria-label="Close OpenClaw’s browser"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form
        className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 sm:px-4"
        onSubmit={(event) => {
          event.preventDefault();
          setEditingAddress(false);
          if (address.trim()) void send({ type: 'navigate', url: address.trim() });
        }}
      >
        <button type="button" onClick={() => send({ type: 'back' })} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => send({ type: 'reload' })} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800" aria-label="Reload">
          <RotateCw className="h-4 w-4" />
        </button>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={() => setEditingAddress(true)}
          onBlur={() => setEditingAddress(false)}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200"
          aria-label="Address"
          spellCheck={false}
        />
      </form>

      {workerBusyWith && (
        <p className="flex items-center gap-2 bg-amber-950/60 px-4 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          OpenClaw is still finishing {workerBusyWith} in this browser. It won’t start anything new while this is open.
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 bg-red-950/60 px-4 py-2 text-xs text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div
        ref={screenRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (text) {
            event.preventDefault();
            void send({ type: 'text', text });
          }
        }}
        onWheel={onWheel}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        {frame ? (
          <img
            src={frame.src}
            alt={frame.title || 'OpenClaw’s browser'}
            draggable={false}
            onClick={(event) => {
              screenRef.current?.focus({ preventScroll: true });
              const point = pagePoint(event.clientX, event.clientY);
              if (point) void send({ type: 'click', ...point });
            }}
            className="max-h-full max-w-full cursor-pointer select-none object-contain"
          />
        ) : (
          !error && <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-label="Opening OpenClaw’s browser" />
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-800 px-3 py-3 sm:px-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!typed) return;
            void send({ type: 'text', text: typed });
            setTyped('');
          }}
        >
          <Keyboard className="hidden h-4 w-4 shrink-0 text-slate-500 sm:block" aria-hidden="true" />
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Type into the focused field…"
            className="h-9 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800">
            <Send className="h-3.5 w-3.5" /> Type
          </button>
          <button type="button" onClick={() => send({ type: 'key', key: 'Enter' })} className="h-9 rounded-md border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800">
            Enter
          </button>
        </form>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto hidden text-xs text-slate-500 md:block">
            Click the picture to click the page; with it focused, your keyboard and scroll wheel go to the page too.
          </p>
          <button
            type="button"
            onClick={() => finish('submitted')}
            disabled={finishing !== null}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-700 px-4 text-sm font-semibold text-emerald-200 hover:bg-emerald-950 disabled:opacity-60"
          >
            {finishing === 'submitted' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            I submitted it myself
          </button>
          <button
            type="button"
            onClick={() => finish('hand-back')}
            disabled={finishing !== null}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {finishing === 'hand-back' && <Loader2 className="h-4 w-4 animate-spin" />}
            Done, hand back to OpenClaw
          </button>
        </div>
      </div>
    </div>
  );
}
