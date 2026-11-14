'use client';

/* eslint-disable @next/next/no-img-element -- live frames are private blob URLs */

// A web page in a task's workspace, shown in OpenClaw's own browser: the Chrome OpenClaw drives on the machine it
// runs on, with its cookies and sign-ins. What he sees is that tab's live picture; his clicks, typing and scrolling
// go to it. Nothing is opened until he chooses the page, and nothing is asked of the browser while the page is out
// of sight. The bar says only what is known: where the browser runs, the tab's real title and address, and
// whether pictures are arriving.
import React from 'react';
import { keyToInput, pagePoint, useBrowserStream } from '@/components/openclaw-browser/stream';
import { safeWebUrl, type WebSurface } from '@/lib/task-surfaces';

const ENDPOINT = '/api/openclaw/browser';
const ADAPTIVE = { kind: 'adaptive' } as const;
const WATCHING = { kind: 'adaptive', watching: true } as const;

export const BROWSER_SURFACE_CSS = `
.srb{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;background:#f4f1ec}
.srb-top{flex:none;display:flex;align-items:center;gap:10px;min-width:0;padding:8px 12px;background:#1b130d;color:#f3e9dd;font:12.5px var(--sans)}
.srb-live{flex:none;display:inline-flex;align-items:center;gap:6px;font:500 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#bfae9c}
.srb-live i{width:8px;height:8px;border-radius:50%;background:#7a6a5c}
.srb-live.on{color:#8ff0b6}
.srb-live.on i{background:#34d07f;box-shadow:0 0 0 3px rgba(52,208,127,.22);animation:srp-pulse 2.2s ease-in-out infinite}
.srb-live.bad{color:#ffb59a}
.srb-live.bad i{background:#e2661f}
.srb-top b{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.srb-top span.h{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bfae9c}
.srb-top a{margin-left:auto;flex:none;color:#ffd2a8;text-decoration:none;font-size:12px;white-space:nowrap}
.srb-top a:hover{text-decoration:underline}
.srb-addr{flex:none;display:flex;align-items:center;gap:6px;min-width:0;padding:6px 10px;background:#fbf9f6;border-bottom:1px solid rgba(40,22,10,.14)}
.srb-addr button{flex:none;width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:#5b4230;font:15px/1 var(--sans);cursor:pointer}
.srb-addr button.fit{width:auto;padding:0 9px;font:500 11.5px var(--sans)}
.srb-addr button:hover:not(:disabled){background:rgba(40,22,10,.08)}
.srb-addr button:disabled{opacity:.35;cursor:default}
.srb-addr button[aria-pressed=true]{background:rgba(40,22,10,.12)}
.srb-ttl{flex:0 1 auto;min-width:0;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 10px;border-radius:999px;background:#fff;border:1px solid rgba(40,22,10,.14);font:500 12px var(--sans);color:#22130a}
.srb-addr input{flex:1 1 0;min-width:0;height:28px;padding:0 12px;border-radius:999px;border:1px solid rgba(40,22,10,.16);background:#fff;color:#3a2616;font:12px var(--mono);outline:0}
.srb-addr input:focus{border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 22%,transparent)}
.srb-note{flex:none;margin:0;padding:6px 12px;background:#fff1e6;border-bottom:1px solid rgba(210,69,26,.25);color:#8a2c0e;font-size:12.5px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.srb-note button{border:0;background:none;padding:0;color:var(--a);font:500 12.5px var(--sans);text-decoration:underline;cursor:pointer}
.srb-screen{position:relative;flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;outline:0;background:#e9e4dc;overscroll-behavior:contain}
.srb-screen.zoomed{overflow:auto;justify-content:flex-start}
.srb-screen:focus-visible{box-shadow:inset 0 0 0 2px var(--a)}
.srb-screen img{display:block;max-width:100%;max-height:100%;object-fit:contain;object-position:top;cursor:pointer;user-select:none;-webkit-user-drag:none;background:#fff;box-shadow:0 10px 30px -18px rgba(40,22,10,.6)}
.srb-screen.zoomed img{max-width:none;max-height:none;flex:none}
.srb-card{margin:auto;max-width:440px;padding:24px;display:grid;gap:12px;justify-items:start;text-align:left}
.srb-card h3{margin:0;font:400 24px/1.15 var(--serif);color:#22130a;overflow-wrap:anywhere}
.srb-card p{margin:0;font-size:13.5px;color:#5b4230;overflow-wrap:anywhere}
.srb-card code{font:12px var(--mono);color:#6a4a32;overflow-wrap:anywhere}
.srb-card .acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.srb-card a{color:var(--a);font:500 13px var(--sans);text-decoration:none}
.srb-card a:hover{text-decoration:underline}
.srb-type{flex:none;display:none;gap:6px;padding:6px 10px;background:#fbf9f6;border-top:1px solid rgba(40,22,10,.14)}
.srb-type input{flex:1;min-width:0;height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(40,22,10,.18);background:#fff;font:13px var(--sans);color:#22130a;outline:0}
.srb-type button{flex:none;height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(40,22,10,.2);background:#fff;font:500 12.5px var(--sans);color:#22130a;cursor:pointer}
.narrow .srb-type{display:flex}
.narrow .srb-top span.h{display:none}
.narrow .srb-ttl{display:none}
/* A finger on the picture is the page's: a drag scrolls it there, a tap clicks it (no pan, pinch or image menu). */
.srb-screen img{touch-action:none;-webkit-touch-callout:none}
/* A phone: what is typed in is 16px (iOS zooms in on anything smaller), and what is pressed is a finger wide. */
.cols-1 .srb-addr{gap:2px;padding:2px 6px}
.cols-1 .srb-addr button{width:38px;height:44px;font-size:18px}
.cols-1 .srb-addr button.fit{padding:0 10px;font-size:13px}
.cols-1 .srb-addr input{height:38px;font-size:16px}
.cols-1 .srb-type{padding:6px 8px}
.cols-1 .srb-type input{height:44px;font-size:16px}
.cols-1 .srb-type button{height:44px;padding:0 14px;font-size:14px}
.cols-1 .srb-top a{padding:12px 0;margin:-12px 0}
.cols-1 .srb-note button{padding:10px 4px;margin:-10px -4px}
`;

/**
 * What the workspace keeps about a page it opened: the tab, the machine the browser runs on, and whether the tab
 * was made for this (false when the page was already open there, in a tab that is not the Journal's to close).
 */
export interface OpenedTab { targetId: string; host: string; created: boolean }

export function BrowserSurface({ surface, armed, covered, opened, narrow, watching, onArm, onOpened, onPage }: {
  surface: WebSurface;
  armed: boolean;                 // he chose this page: it may be opened in OpenClaw's browser
  covered: boolean;               // something is drawn over it (the brief, on a phone)
  opened: OpenedTab | null;
  narrow: boolean;
  watching: boolean;              // OpenClaw has a turn out about this page: keep looking at the calm pace
  onArm: () => void;
  onOpened: (tab: OpenedTab | null) => void;
  onPage: (page: { url: string; title: string }) => void;
}) {
  const [opening, setOpening] = React.useState(false);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const [address, setAddress] = React.useState(surface.url);
  const [editing, setEditing] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  // A phone shows the page at its real size and pans; a wide screen fits it.
  const [zoomed, setZoomed] = React.useState(narrow);
  const [onScreen, setOnScreen] = React.useState(true);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const screenRef = React.useRef<HTMLDivElement>(null);
  const wheel = React.useRef({ deltaY: 0, x: 0, y: 0, timer: 0 });

  // Scrolled out of view (the rest of the home page is under the sky): nothing is asked of the browser.
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.05 });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const targetId = opened?.targetId ?? null;
  const active = armed && !covered && onScreen;
  const { frame, error, live, send, kick, touch } = useBrowserStream({ endpoint: ENDPOINT, targetId, active, pace: watching ? WATCHING : ADAPTIVE, dedupe: true });

  const open = React.useCallback(async () => {
    setOpening(true);
    setOpenError(null);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', url: surface.url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'OpenClaw’s browser could not be reached');
      onOpened({ targetId: data.targetId as string, host: typeof data.host === 'string' ? data.host : '', created: data.created === true });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'OpenClaw’s browser could not be reached');
    } finally {
      setOpening(false);
    }
  }, [surface.url, onOpened]);

  // Chosen and not open yet: open it. Once, not on every render; a failure waits for him to retry.
  const tried = React.useRef(false);
  React.useEffect(() => {
    if (!armed || targetId || tried.current) return;
    tried.current = true;
    void open();
  }, [armed, targetId, open]);
  // One open at a time: a second press while the first is out would open a second tab, and only
  // the later one would be remembered and closed when he leaves.
  const retry = () => { if (opening) return; onOpened(null); tried.current = true; void open(); };
  // Coming back to a page that is already open there: its tab may be behind another one he looked at since, and
  // Chrome paints only the tab in front. Bring it forward once, when this page is shown again.
  const shownAgain = React.useRef(targetId);
  React.useEffect(() => {
    const id = shownAgain.current;
    if (!id || !armed) return;
    void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'show', targetId: id }) })
      .then(() => kick())
      .catch(() => {});
    // Only for the tab this was given when it appeared: a tab opened just now is already in front.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pageUrl = frame?.url ?? '';
  const pageTitle = frame?.title ?? '';
  React.useEffect(() => { if (pageUrl) onPage({ url: pageUrl, title: pageTitle }); }, [pageUrl, pageTitle, onPage]);
  React.useEffect(() => { if (pageUrl && !editing) setAddress(pageUrl); }, [pageUrl, editing]);

  // Scrolling the page there: what is asked for in a moment goes in one message, at the last point it was asked at.
  const scrollPage = React.useCallback((deltaY: number, point: { x: number; y: number }) => {
    const w = wheel.current;
    w.deltaY += deltaY;
    w.x = point.x;
    w.y = point.y;
    if (w.timer) return;
    w.timer = window.setTimeout(() => {
      void send({ type: 'scroll', x: w.x, y: w.y, deltaY: w.deltaY });
      w.deltaY = 0;
      w.timer = 0;
    }, 60);
  }, [send]);

  // The wheel moves the page in OpenClaw's browser, not the Journal under the pointer.
  React.useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (zoomed || !frame) return;
      event.preventDefault();
      const point = pagePoint(el.querySelector('img'), frame, event.clientX, event.clientY);
      if (!point) return;
      scrollPage(event.deltaY, point);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [frame, scrollPage, zoomed]);

  // A finger does the same. Dragged on the picture, the page follows it: at full size the picture pans first and
  // the page there scrolls once the picture is at its top or foot; fitted, the page scrolls. (The browser is only
  // ever scrolled up and down from here.) Moved less than a few pixels it is a tap, and the tap is a click.
  const frameRef = React.useRef(frame);
  frameRef.current = frame;
  const dragged = React.useRef(false);
  React.useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
    const down = (event: PointerEvent) => {
      dragged.current = false;
      if (event.pointerType !== 'touch' || !event.isPrimary || !(event.target instanceof HTMLImageElement)) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8) return;
      drag.moved = true;
      dragged.current = true;
      event.preventDefault();
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      let rest = dy;
      if (zoomed) {
        el.scrollLeft -= dx;
        const top = el.scrollTop;
        el.scrollTop -= dy;
        rest = dy + (el.scrollTop - top);   // what the picture could not take
      }
      const shown = frameRef.current, image = el.querySelector('img');
      if (Math.abs(rest) < 0.5 || !shown || !image) return;
      const point = pagePoint(image, shown, event.clientX, event.clientY);
      const height = image.getBoundingClientRect().height;
      if (!point || height === 0) return;
      const density = Math.max(1, Math.round(image.naturalWidth / shown.width));
      const pageHeight = image.naturalHeight ? image.naturalHeight / density : shown.height;
      scrollPage(-rest * (pageHeight / height), point);
    };
    const up = (event: PointerEvent) => { if (drag && event.pointerId === drag.id) drag = null; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move, { passive: false });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [scrollPage, zoomed]);

  // "Fit": the page is laid out for a window the size of this space, so it reads at full size here instead of as a
  // shrunk picture of a wide window. It lasts while the workspace is open and follows the space as it changes.
  const [fitted, setFitted] = React.useState(false);
  const fitSize = React.useRef('');
  const applyFit = React.useCallback(async (on: boolean) => {
    const el = screenRef.current;
    if (!targetId || !el) return;
    // Never narrower or shorter than a small window: in less room than that the picture is scaled down instead.
    const width = Math.max(320, Math.round(el.clientWidth)), height = Math.max(240, Math.round(el.clientHeight));
    const key = on ? `${width}x${height}` : '';
    if (key === fitSize.current) return;
    fitSize.current = key;
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'viewport', targetId, ...(on ? { width, height } : {}) }),
      });
      if (!response.ok) fitSize.current = on ? '' : fitSize.current;
    } catch { fitSize.current = ''; }
    kick();
  }, [targetId, kick]);
  React.useEffect(() => {
    const el = screenRef.current;
    if (!fitted || !el || typeof ResizeObserver === 'undefined') return;
    let timer = 0;
    const watch = new ResizeObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(() => void applyFit(true), 250); });
    watch.observe(el);
    return () => { watch.disconnect(); window.clearTimeout(timer); };
  }, [fitted, applyFit]);
  // Leaving the page (another tab of the workspace) gives the tab its own size back.
  const leaving = React.useRef({ fitted, targetId });
  leaving.current = { fitted, targetId };
  React.useEffect(() => () => {
    const { fitted: on, targetId: id } = leaving.current;
    if (on && id) void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'viewport', targetId: id }), keepalive: true }).catch(() => {});
  }, []);
  const toggleFit = () => { const on = !fitted; setFitted(on); if (on) setZoomed(false); void applyFit(on); };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const input = keyToInput(event);
    if (!input) return;
    // The key is the page's: the Journal's own shortcuts (Escape closes the workspace) do not see it.
    event.preventDefault();
    event.stopPropagation();
    void send(input);
  };
  const go = (event: React.FormEvent) => {
    event.preventDefault();
    setEditing(false);
    const url = safeWebUrl(address);
    if (url === null) { setAddress(pageUrl || surface.url); return; }
    void send({ type: 'navigate', url });
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const trouble = openError ?? (frame ? null : error);
  const state = !armed ? 'off' : trouble || error ? 'bad' : live ? 'on' : 'wait';
  const host = opened?.host;
  const mine = frame?.url || surface.url;

  return (
    <div className="srb" ref={rootRef}>
      <div className="srb-top">
        <span className={`srb-live ${state === 'on' ? 'on' : state === 'bad' ? 'bad' : ''}`} role="status">
          <i aria-hidden="true" />{state === 'on' ? 'Live' : state === 'bad' ? 'Not reachable' : state === 'off' ? 'Not opened' : opening || !frame ? 'Opening' : 'Paused'}
        </span>
        <b>OpenClaw browser</b>
        {host && <span className="h">running on {host}</span>}
        <a href={mine} target="_blank" rel="noopener noreferrer">Open in your browser ↗</a>
      </div>
      {armed && targetId && (
        <form className="srb-addr" onSubmit={go}>
          <button type="button" onClick={() => void send({ type: 'back' })} aria-label="Back" disabled={!frame}>‹</button>
          <button type="button" onClick={() => void send({ type: 'forward' })} aria-label="Forward" disabled={!frame}>›</button>
          <button type="button" onClick={() => void send({ type: 'reload' })} aria-label="Reload" disabled={!frame}>⟳</button>
          <button type="button" onClick={() => setZoomed((z) => !z)} aria-pressed={zoomed} aria-label={zoomed ? 'Fit the page to this space' : 'Show the page at full size'} title={zoomed ? 'Fit the page' : 'Full size'} disabled={!frame}>{zoomed ? '⤡' : '⤢'}</button>
          <button type="button" className="fit" onClick={toggleFit} aria-pressed={fitted} disabled={!frame} title={fitted ? 'Give the tab its own window size back' : 'Lay the page out to fit this space'}>Fit</button>
          {pageTitle && <span className="srb-ttl" title={pageTitle}>{pageTitle}</span>}
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAddress(pageUrl || surface.url); e.currentTarget.blur(); } }}
            aria-label="Address of the page in OpenClaw’s browser"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </form>
      )}
      {frame && error && (
        <p className="srb-note" role="alert">{error}<button type="button" onClick={kick}>Try again</button><button type="button" onClick={retry} disabled={opening}>Open the page again</button></p>
      )}
      <div
        ref={screenRef}
        className={`srb-screen${zoomed ? ' zoomed' : ''}`}
        tabIndex={frame ? 0 : -1}
        onKeyDown={frame ? onKeyDown : undefined}
        onPointerMove={touch}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (frame && text) { event.preventDefault(); void send({ type: 'text', text }); }
        }}
        aria-label={frame ? `${pageTitle || surface.label}, live in OpenClaw’s browser. Click to click the page; with it focused, your keys go to the page.` : undefined}
      >
        {!armed ? (
          <div className="srb-card">
            <h3>{surface.label}</h3>
            <p><code>{surface.url}</code></p>
            <p>This page opens in OpenClaw’s browser, signed in as OpenClaw is. It is not opened until you ask.</p>
            <div className="acts">
              <button type="button" className="srp-btn" onClick={onArm}>Open it here</button>
              <a href={surface.url} target="_blank" rel="noopener noreferrer">Open in your browser ↗</a>
            </div>
          </div>
        ) : frame ? (
          <img
            src={frame.src}
            alt={pageTitle || surface.label}
            draggable={false}
            style={zoomed ? { width: frame.width } : undefined}
            onClick={(event) => {
              // The end of a drag is not a click.
              if (dragged.current) { dragged.current = false; return; }
              screenRef.current?.focus({ preventScroll: true });
              const point = pagePoint(event.currentTarget, frame, event.clientX, event.clientY);
              if (point) void send({ type: 'click', ...point });
            }}
          />
        ) : trouble ? (
          <div className="srb-card" role="alert">
            <h3>OpenClaw’s browser isn’t reachable</h3>
            <p>{trouble}</p>
            <div className="acts">
              <button type="button" className="srp-btn" onClick={retry} disabled={opening}>{opening ? 'Trying…' : 'Try again'}</button>
              <a href={surface.url} target="_blank" rel="noopener noreferrer">Open in your browser ↗</a>
            </div>
          </div>
        ) : (
          <div className="srb-card"><span className="srp-working"><i aria-hidden="true" />Opening in OpenClaw’s browser…</span></div>
        )}
      </div>
      {frame && (
        <form className="srb-type" onSubmit={(e) => { e.preventDefault(); if (typed) { void send({ type: 'text', text: typed }); setTyped(''); } }}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type into the page’s focused field…" aria-label="Type into the page" />
          <button type="submit">Type</button>
          <button type="button" onClick={() => void send({ type: 'key', key: 'Enter' })}>Enter</button>
        </form>
      )}
    </div>
  );
}
