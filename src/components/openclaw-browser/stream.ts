'use client';

// The live picture of one tab in OpenClaw's browser, and the way his clicks and keys get back to it. Shared by
// the job application viewer (OpenClawBrowserViewer) and a task's workspace (sunrise/BrowserSurface): each talks
// to its own route, which answer the same way (a JPEG with the page's address, title and size in the headers;
// POST { action: 'input', targetId, input }).
import React from 'react';

export type BrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' };

export interface BrowserFrame {
  src: string;
  url: string;
  title: string;
  width: number;
  height: number;
  /** The page opened a file picker and is waiting for a file. */
  fileChooser?: string;
}

export const FORWARDED_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
]);

/** What a key pressed over the picture means to the page, or null when it is not for the page (paste, an F-key). */
export function keyToInput(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): BrowserInput | null {
  const command = event.ctrlKey || event.metaKey;
  // Paste arrives as a paste event with the text.
  if (command && event.key.toLowerCase() === 'v') return null;
  if (command && /^[a-z]$/i.test(event.key)) return { type: 'key', key: event.key.toLowerCase(), ctrl: true, shift: event.shiftKey };
  if (FORWARDED_KEYS.has(event.key)) return { type: 'key', key: event.key, shift: event.shiftKey };
  if (event.key.length === 1 && !command && !event.altKey) return { type: 'text', text: event.key };
  return null;
}

/**
 * How often to ask for a picture. `steady` asks at one pace, whatever happens (the job application viewer).
 * `adaptive` follows what he is doing; with `watching` it never drops to the idle pace, for a page something else
 * is expected to move.
 */
export type StreamPace = { kind: 'steady'; everyMs: number } | { kind: 'adaptive'; watching?: boolean };

// Adaptive: quick right after he touches the page, a calm pace while he is watching, slow once nothing has moved
// for a while. Any input, or a picture that changed, makes it quick again.
const QUICK_MS = 140;
const QUICK_FOR_MS = 2500;
const WATCH_MS = 500;
const IDLE_AFTER_MS = 20_000;
const IDLE_MS = 1600;
// A picture counts as arriving while the last one came within this long.
const LIVE_WITHIN_MS = 5000;

export function nextFrameDelay(pace: StreamPace, sinceActiveMs: number, failures: number): number {
  // A steady viewer retries at its own pace, as it always has. An adaptive one would otherwise retry a browser
  // that is down seven times a second, so it backs off: 1s, 2s, 4s, then every 8s.
  if (pace.kind === 'steady') return pace.everyMs;
  if (failures > 0) return Math.min(8000, 1000 * 2 ** Math.min(failures - 1, 3));
  if (sinceActiveMs < QUICK_FOR_MS) return QUICK_MS;
  if (sinceActiveMs < IDLE_AFTER_MS || pace.watching) return WATCH_MS;
  return IDLE_MS;
}

/**
 * Polls one tab's picture while `active`, and sends input to it. Nothing is asked for while `active` is false or
 * the browser tab he is in is hidden. `live` is true only while pictures are really arriving.
 */
export function useBrowserStream({ endpoint, targetId, active = true, pace, dedupe = false }: {
  endpoint: string;
  targetId: string | null;
  active?: boolean;
  pace: StreamPace;
  dedupe?: boolean;
}) {
  const [frame, setFrame] = React.useState<BrowserFrame | null>(null);
  const [error, setErrorState] = React.useState<string | null>(null);
  // Whether the message showing is the picture's own ("Lost the browser picture"). Only that one
  // is cleared by the next good frame: a failed save, upload or keypress used to be written to the
  // same slot and was wiped within one poll, before it could be read.
  const frameError = React.useRef(false);
  const setError = React.useCallback((message: string | null) => { frameError.current = false; setErrorState(message); }, []);
  const [live, setLive] = React.useState(false);
  const kickRef = React.useRef<() => void>(() => undefined);
  const lastActive = React.useRef(0);
  const paceRef = React.useRef(pace);
  paceRef.current = pace;

  const touch = React.useCallback(() => { lastActive.current = Date.now(); }, []);
  const kick = React.useCallback(() => { lastActive.current = Date.now(); kickRef.current(); }, []);

  React.useEffect(() => {
    if (!targetId || !active) { setLive(false); return; }
    let stopped = false;
    let wake: () => void = () => undefined;
    let have = '';
    let failures = 0;
    let lastFrameAt = 0;
    lastActive.current = Date.now();
    kickRef.current = () => wake();
    const onVisible = () => { if (document.visibilityState === 'visible') { lastActive.current = Date.now(); wake(); } };
    document.addEventListener('visibilitychange', onVisible);
    const loop = async () => {
      while (!stopped) {
        if (document.visibilityState === 'visible') {
          try {
            const query = `targetId=${encodeURIComponent(targetId)}${dedupe && have ? `&have=${have}` : ''}`;
            const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store' });
            if (stopped) return;
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(data.error || 'Lost the browser picture');
            }
            const meta = {
              url: decodeURIComponent(response.headers.get('X-Page-Url') ?? ''),
              title: decodeURIComponent(response.headers.get('X-Page-Title') ?? ''),
              width: Number(response.headers.get('X-Viewport-Width')) || 1,
              height: Number(response.headers.get('X-Viewport-Height')) || 1,
              ...(response.headers.get('X-File-Chooser') ? { fileChooser: response.headers.get('X-File-Chooser')! } : {}),
            };
            if (response.status === 204) {
              // The same picture as before; the page may still have a new address or title.
              setFrame((previous) => (previous && (previous.url !== meta.url || previous.title !== meta.title) ? { ...previous, ...meta } : previous));
            } else {
              const blob = await response.blob();
              if (stopped) return;
              have = response.headers.get('X-Frame-Id') ?? '';
              const next: BrowserFrame = { src: URL.createObjectURL(blob), ...meta };
              setFrame((previous) => {
                if (previous) URL.revokeObjectURL(previous.src);
                return next;
              });
              // The page is moving: keep up with it.
              if (lastFrameAt !== 0) lastActive.current = Math.max(lastActive.current, Date.now() - QUICK_FOR_MS);
            }
            lastFrameAt = Date.now();
            failures = 0;
            setLive(true);
            if (frameError.current) { frameError.current = false; setErrorState(null); }
          } catch (pictureError) {
            if (stopped) return;
            failures += 1;
            setLive(false);
            frameError.current = true;
            setErrorState(pictureError instanceof Error ? pictureError.message : 'Lost the browser picture');
          }
        } else {
          setLive(false);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, nextFrameDelay(paceRef.current, Date.now() - lastActive.current, failures));
          wake = () => { clearTimeout(timer); resolve(); };
        });
      }
    };
    void loop();
    // A picture that stopped coming (a stalled request) is not live, whatever the last one said.
    const watch = window.setInterval(() => { if (lastFrameAt !== 0 && Date.now() - lastFrameAt > LIVE_WITHIN_MS) setLive(false); }, 1500);
    return () => {
      stopped = true;
      wake();
      window.clearInterval(watch);
      document.removeEventListener('visibilitychange', onVisible);
      setLive(false);
    };
  }, [endpoint, targetId, active, dedupe]);

  const frameSrcRef = React.useRef<string | null>(null);
  frameSrcRef.current = frame?.src ?? null;
  React.useEffect(() => () => {
    if (frameSrcRef.current) URL.revokeObjectURL(frameSrcRef.current);
  }, []);

  // What he does reaches the page in the order he did it: each input waits for the one before. Sent side by side,
  // a fast typist's keys could overtake one another on the way (a Backspace landing before the letter it deletes).
  const sending = React.useRef<Promise<void>>(Promise.resolve());
  const send = React.useCallback((input: BrowserInput): Promise<void> => {
    if (!targetId) return Promise.resolve();
    lastActive.current = Date.now();
    const deliver = async () => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'input', targetId, input }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'That did not reach the browser');
        // The next thing he does that gets through takes the last failure's message down.
        if (!frameError.current) setErrorState(null);
      } catch (inputError) {
        setError(inputError instanceof Error ? inputError.message : 'That did not reach the browser');
      }
      // Pages take a moment to react.
      setTimeout(() => kickRef.current(), 150);
    };
    const sent = sending.current.then(deliver);
    sending.current = sent;
    return sent;
  }, [endpoint, targetId, setError]);

  return { frame, setFrame, error, setError, live, send, kick, touch };
}

/** Where a point on the shown picture is on the page itself. */
export function pagePoint(image: HTMLImageElement | null | undefined, frame: BrowserFrame | null, clientX: number, clientY: number) {
  if (!image || !frame) return null;
  const rect = image.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  // The picture is the whole window, scrollbar included, at the screen's pixel density; the reported size is the
  // page's own, without the scrollbar. Clicks are placed on the picture's true size in page pixels.
  const density = Math.max(1, Math.round(image.naturalWidth / frame.width));
  const width = image.naturalWidth ? image.naturalWidth / density : frame.width;
  const height = image.naturalHeight ? image.naturalHeight / density : frame.height;
  return {
    x: Math.round(((clientX - rect.left) / rect.width) * width),
    y: Math.round(((clientY - rect.top) / rect.height) * height),
  };
}
