'use client';

// A real file of the task, in its workspace, shown as the thing it is (a `file` block of the work names it; the
// file is read from OpenClaw's workspace folder by /api/tasks/files). A PDF is laid out the way slideshow apps
// lay out a deck: its pages down the left, the page he is on in the middle exactly as the file draws it, and what
// he will say on that page in a notes pane under it, which he types in. A document is its text, an image is the
// image, and anything else is a card to download it from. The file is looked at again every few seconds, so a
// version OpenClaw writes shows by itself. Nothing in a file is edited here: changes go to OpenClaw, by chat.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileBlock } from '@/lib/shapes/work';
import { fileExt, fileFolder, fileName, fileSize, fileUrl, type FileMeta } from '@/lib/task-files';

export const FILE_SURFACE_CSS = `
.srf{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}
.srf-strip{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:9px 12px;border-bottom:1px solid rgba(60,30,10,.1)}
.srf-strip:empty{display:none}
.srf-strip a:not(.srp-jump){color:var(--a);text-decoration:none;font:500 12.5px var(--sans);white-space:nowrap}
.srf-strip a:not(.srp-jump):hover{text-decoration:underline}
.srf-strip a.srp-jump{text-decoration:none}
.srf-strip .sp{flex:1 1 0;min-width:0}
.srp .srf-tally{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:999px;border:1px solid #bfe3cd;background:#edf8f1;color:#14603a;font:600 12.5px var(--sans);cursor:pointer}
.srp .srf-tally.open{border-color:rgba(60,30,10,.18);background:rgba(255,255,255,.75);color:#4a2f1c}
.srf-win{flex:1;min-height:0;display:flex;flex-direction:column;margin:10px;border-radius:12px;overflow:hidden;background:linear-gradient(180deg,color-mix(in srgb,var(--a) 22%,#211a28),#1b1520);color:#fff;box-shadow:0 18px 44px -30px rgba(40,22,10,.7)}
.srf-head{flex:none;display:flex;align-items:center;gap:10px;min-width:0;padding:8px 12px 8px 14px;border-bottom:1px solid rgba(0,0,0,.4);font:12.5px var(--sans);color:rgba(255,255,255,.76)}
.srf-tag{flex:none;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.16);color:#fff;font:600 9px var(--mono);letter-spacing:.06em;text-transform:uppercase}
.srf-tag.pdf{background:#b3261e}
.srf-head b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13px var(--sans);color:#fff}
.srf-where{flex:0 5 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srf-head .sp{flex:1 1 0;min-width:0}
.srf-count{flex:none;font:500 11px var(--mono);letter-spacing:.06em}
.srp .srf-btn{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;font:500 12.5px var(--sans);text-decoration:none;white-space:nowrap;cursor:pointer}
.srp .srf-btn:hover{background:rgba(255,255,255,.2)}
.srp .srf-btn.sq{width:30px;padding:0;justify-content:center;border-radius:9px}
.srp .srf-btn:disabled{opacity:.4;cursor:default}
/* A deck: the pages down the left, the page, and what he will say under it. */
.srf-deck{flex:1;min-height:0;display:grid;grid-template-columns:172px minmax(0,1fr);outline:0}
.srf-nav{min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;padding:14px 14px 14px 10px;background:rgba(0,0,0,.28);border-right:1px solid rgba(0,0,0,.4)}
.srp .srf-nav button{flex:none;position:relative;display:block;margin-left:20px;padding:0;border:0;border-radius:4px;background:#111;cursor:pointer;outline:2px solid transparent;outline-offset:2px;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.srf-nav button small{position:absolute;left:-20px;top:2px;width:14px;text-align:right;font:10.5px var(--mono);color:rgba(255,255,255,.6)}
.srp .srf-nav button.on{outline-color:color-mix(in srgb,var(--a) 50%,#fff)}
.srf-nav button.on small{color:#fff}
.srf-nav img{display:block;width:100%;aspect-ratio:var(--ratio);border-radius:3px;background:#fff}
.srf-stage{container-type:size;min-width:0;min-height:0;display:flex;flex-direction:column}
.srf-page{container-type:size;flex:1 1 0;min-height:120px;display:flex;align-items:center;justify-content:center;margin:16px 20px 0}
.srf-page img{flex:none;display:block;width:min(100cqw,calc(100cqh * var(--ratio)));aspect-ratio:var(--ratio);border-radius:4px;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.2),0 0 60px 4px color-mix(in srgb,var(--glow) 34%,transparent)}
.srf-split{flex:none;position:relative;height:16px;cursor:row-resize;touch-action:none}
.srf-split::after{content:"";position:absolute;left:50%;top:6px;width:44px;height:4px;margin-left:-22px;border-radius:999px;background:rgba(255,255,255,.28)}
.srf-split:hover::after,.srf-split.on::after{background:rgba(255,255,255,.6)}
.srf-notes{flex:none;height:clamp(104px,23cqh,190px);display:flex;flex-direction:column;gap:5px;min-height:0;margin:0 20px 16px;padding:10px 14px 10px;border-radius:10px;background:#fffdf8;color:#22130a;box-shadow:inset 0 1px 0 #fff}
.srf-notes>span{flex:none;display:flex;justify-content:space-between;gap:10px;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#8a6a52}
.srf-notes>span em{font-style:normal;letter-spacing:.04em;text-transform:none;color:#a08268}
.srf-notes textarea{flex:1;min-height:0;resize:none;padding:0;border:0;outline:0;background:transparent;color:#22130a;font:15px/1.55 var(--sans)}
.srf-notes textarea::placeholder{color:#a08268}
/* Presenting: the page alone on the whole screen, as it will be shown. */
.srf-show{display:none}
.srf-show:fullscreen{display:flex;align-items:center;justify-content:center;background:#000;cursor:none}
.srf-show:fullscreen img{width:100vw;height:100vh;object-fit:contain}
/* A document, an image, and a file that can only be downloaded. */
.srf-doc{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:30px 32px 44px;background:#fffefb;color:#22130a}
.srf-doc article{max-width:760px;margin:0 auto;font:15.5px/1.62 var(--sans);overflow-wrap:anywhere}
.srf-doc h1{margin:0 0 14px;font:400 32px/1.12 var(--serif)}
.srf-doc h2{margin:26px 0 8px;font:600 20px/1.25 var(--sans)}
.srf-doc h3{margin:22px 0 6px;font:600 16.5px/1.3 var(--sans)}
.srf-doc p,.srf-doc ul,.srf-doc ol,.srf-doc blockquote,.srf-doc pre,.srf-doc table{margin:10px 0}
.srf-doc ul{list-style:disc;padding-left:24px}
.srf-doc ol{list-style:decimal;padding-left:24px}
.srf-doc li{margin:3px 0}
.srf-doc blockquote{padding:12px 18px;border-radius:10px;background:#faf3e8;color:#3d2a1c}
.srf-doc blockquote>:first-child{margin-top:0} .srf-doc blockquote>:last-child{margin-bottom:0}
.srf-doc hr{border:0;border-top:1px solid rgba(60,30,10,.14);margin:22px 0}
.srf-doc a{color:var(--a)}
.srf-doc code{font:13px var(--mono);background:rgba(120,70,30,.09);border-radius:5px;padding:1px 5px}
.srf-doc pre{overflow:auto;padding:12px 14px;border-radius:10px;background:#22130a;color:#ffe9d2;font:13px/1.5 var(--mono)}
.srf-doc pre code{background:none;padding:0;color:inherit}
.srf-doc table{border-collapse:collapse;font-size:14px}
.srf-doc td,.srf-doc th{border:1px solid rgba(60,30,10,.16);padding:4px 9px;text-align:left}
.srf-doc pre.plain{background:none;color:#22130a;padding:0;white-space:pre-wrap}
.srf-doc .cut{font-size:13px;color:#8a6a52}
.srf-pic{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:20px}
.srf-pic img{max-width:100%;max-height:100%;border-radius:4px;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.2)}
.srf-card{flex:1;min-height:0;display:grid;place-content:center;justify-items:center;gap:10px;padding:32px;text-align:center;color:rgba(255,255,255,.8);font:14px/1.5 var(--sans)}
.srf-card b{font:400 26px/1.15 var(--serif);color:#fff;overflow-wrap:anywhere}
.srf-card p{margin:0;max-width:52ch}
/* A phone: the pages run across the top, and what is pressed is a finger wide. */
.cols-1 .srf-win{margin:0;border-radius:10px}
.cols-1 .srf-head{flex-wrap:wrap;row-gap:6px;padding:8px 10px}
.cols-1 .srf-where,.cols-1 .srf-btn .lbl{display:none}
.srp.cols-1 .srf-btn{height:40px;min-width:40px;justify-content:center}
.cols-1 .srf-deck{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
.cols-1 .srf-nav{flex-direction:row;overflow:auto hidden;gap:10px;padding:10px;border-right:0;border-bottom:1px solid rgba(0,0,0,.4)}
.srp.cols-1 .srf-nav button{flex:0 0 104px;margin-left:0}
.cols-1 .srf-nav button small{position:static;display:none}
.srp.cols-1 .srf-btn.sq{display:none}
/* The page is as wide as the phone, and the notes take the room under it. */
.cols-1 .srf-stage{overflow:auto;overscroll-behavior:contain}
.cols-1 .srf-page{container-type:normal;flex:none;min-height:0;margin:10px 10px 0}
.cols-1 .srf-page img{width:100%}
.cols-1 .srf-split{display:none}
.cols-1 .srf-notes{flex:1 0 auto;height:auto!important;min-height:132px;margin:10px}
.cols-1 .srf-notes textarea{font-size:16px}
.cols-1 .srf-doc{padding:18px 16px 32px}
`;

/** "just now", "12m ago", "today at 12:20 PM", "Sat Nov 14 at 11:58 PM". */
function savedWhen(mtime: number, now = Date.now()): string {
  const mins = Math.round((now - mtime) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const d = new Date(mtime);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (new Date(now).toDateString() === d.toDateString()) return `today at ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

const NOTES_KEY = 'sr-file-notes-h';
const NOTES_H = { min: 84, max: 420 } as const;
const TEXT_MAX = 300_000;
const mdLink = { a: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} target="_blank" rel="noopener noreferrer" /> };

/** A document's words, read from the file. */
function TextView({ url, markdown }: { url: string; markdown: boolean }) {
  const [text, setText] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    let cancelled = false;
    fetch(url).then((res) => (res.ok ? res.text() : Promise.reject(new Error('unread')))).then((body) => { if (!cancelled) setText(body); }).catch(() => { if (!cancelled) setText(null); });
    return () => { cancelled = true; };
  }, [url]);
  const shown = text && text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text;
  return (
    <div className="srf-doc">
      <article>
        {text === undefined ? <p className="cut">Opening…</p> : text === null ? <p className="cut">The file could not be read.</p>
          : markdown ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdLink}>{shown ?? ''}</ReactMarkdown> : <pre className="plain">{shown}</pre>}
        {text && text.length > TEXT_MAX && <p className="cut">The file goes on: only its first {TEXT_MAX.toLocaleString('en-US')} characters are shown. Download it for the rest.</p>}
      </article>
    </div>
  );
}

/** A deck: its pages, the page he is on, and what he will say on it. */
function DeckView({ taskId, block, meta, page, onPage, onNote, saving, show }: {
  taskId: string; block: FileBlock; meta: FileMeta; page: number; onPage: (page: number) => void; onNote: (index: number, text: string) => void;
  saving: 'idle' | 'saving' | 'saved' | 'failed'; show: React.RefObject<HTMLDivElement | null>;
}) {
  const pages = meta.pages ?? 1;
  const at = Math.max(1, Math.min(pages, page));
  const ratio = meta.ratio ?? 16 / 9;
  const [wide] = React.useState<1600 | 2400>(() => (typeof window !== 'undefined' && window.devicePixelRatio > 1.4 ? 2400 : 1600));
  const src = (n: number, width: 320 | 1600 | 2400) => fileUrl(taskId, block.id, { page: n, width, v: meta.mtime });
  const go = React.useCallback((to: number) => onPage(Math.max(1, Math.min(pages, to))), [onPage, pages]);

  // The page he is on stays in view in the list of pages.
  const nav = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { nav.current?.querySelector<HTMLElement>('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [at]);

  // How tall the notes are: where he dragged them (kept in this browser), else about a quarter of the room.
  const [notesH, setNotesH] = React.useState<number | null>(() => {
    try {
      const stored = Number(window.localStorage.getItem(NOTES_KEY));
      return Number.isFinite(stored) && stored >= NOTES_H.min ? Math.min(NOTES_H.max, stored) : null;
    } catch { return null; }
  });
  const dragNotes = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const from = event.clientY;
    const start = notesH ?? Math.round(grip.nextElementSibling?.getBoundingClientRect().height ?? 160);
    let now = start;
    const move = (e: PointerEvent) => { now = Math.round(Math.max(NOTES_H.min, Math.min(NOTES_H.max, start - (e.clientY - from)))); setNotesH(now); };
    const end = () => {
      grip.classList.remove('on');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      try { window.localStorage.setItem(NOTES_KEY, String(now)); } catch { /* it still holds for this visit */ }
    };
    grip.classList.add('on');
    try { grip.setPointerCapture(event.pointerId); } catch { /* the drag still follows over the grip */ }
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  };

  // The arrow keys turn the pages, as in any slideshow app, unless he is typing his notes.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === 'TEXTAREA' || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    go(at + step);
  };

  // Presenting: on the whole screen the keys and a press turn the pages. Escape leaves the show and nothing more:
  // the task stays open, whether the browser handed the key to the page before or after it left the full screen.
  const leftShowAt = React.useRef(0);
  React.useEffect(() => {
    let showing = document.fullscreenElement === show.current && show.current !== null;
    const onChange = () => {
      const now = document.fullscreenElement === show.current && show.current !== null;
      if (showing && !now) leftShowAt.current = Date.now();
      showing = now;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [show]);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const showing = document.fullscreenElement === show.current && show.current !== null;
      if (event.key === 'Escape' && (showing || Date.now() - leftShowAt.current < 600)) {
        event.preventDefault();
        event.stopPropagation();
        if (showing) void document.exitFullscreen().catch(() => {});
        return;
      }
      if (!showing) return;
      const step = [' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key) ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      event.stopPropagation();
      go(at + step);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [at, go, show]);

  const note = block.notes?.[at - 1] ?? '';
  return (
    <div className="srf-deck" tabIndex={0} onKeyDown={onKeyDown} style={{ '--ratio': String(ratio) } as React.CSSProperties} aria-label={`${meta.name}, page ${at} of ${pages}`}>
      <div className="srf-nav" ref={nav} role="tablist" aria-label="Pages" aria-orientation="vertical">
        {Array.from({ length: pages }, (_, i) => (
          <button key={i} type="button" role="tab" aria-selected={i + 1 === at} className={i + 1 === at ? 'on' : undefined} onClick={() => onPage(i + 1)} aria-label={`Page ${i + 1}`}>
            <small aria-hidden="true">{i + 1}</small>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src(i + 1, 320)} alt="" loading="lazy" draggable={false} />
          </button>
        ))}
      </div>
      <div className="srf-stage">
        <div className="srf-page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={at} src={src(at, wide)} alt={`Page ${at} of ${meta.name}, as the file draws it`} draggable={false} />
        </div>
        <div className="srf-split" role="separator" aria-orientation="horizontal" aria-label="Drag to make the notes taller or shorter" onPointerDown={dragNotes} />
        <label className="srf-notes" style={notesH === null ? undefined : { height: notesH }}>
          <span>What you will say · page {at}<em role="status">{saving === 'saving' ? 'Saving…' : saving === 'failed' ? 'Not saved. Keep typing to retry' : saving === 'saved' ? 'Saved' : ''}</em></span>
          <textarea key={at} value={note} placeholder="Click to add notes" onChange={(e) => onNote(at - 1, e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') e.currentTarget.blur(); }} onKeyUp={(e) => e.stopPropagation()} />
        </label>
      </div>
      <div className="srf-show" ref={show} onClick={() => go(at + 1)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(at, wide)} alt={`Page ${at} of ${pages}`} draggable={false} />
      </div>
    </div>
  );
}

/**
 * One file of the task. `head` is what sits above it (the task's next step, its checklist's tally). `onAsk` opens
 * the chat to ask OpenClaw for a change to what is showing.
 */
export function FileSurface({ taskId, block, page, onPage, onNote, saving, onAsk, head }: {
  taskId: string;
  block: FileBlock;
  page: number;
  onPage: (page: number) => void;
  onNote: (index: number, text: string) => void;
  saving: 'idle' | 'saving' | 'saved' | 'failed';
  onAsk: () => void;
  head?: React.ReactNode;
}) {
  // What the file is now, asked again every few seconds: a file written again is shown again.
  const [meta, setMeta] = React.useState<FileMeta | null | undefined>(undefined);
  const [problem, setProblem] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = async (first: boolean) => {
      if (!first && document.visibilityState !== 'visible') return;
      try {
        const json = await (await fetch(fileUrl(taskId, block.id))).json();
        if (cancelled) return;
        if (json?.success) {
          const now = json.data as FileMeta;
          setMeta((was) => (was && was.mtime === now.mtime && was.size === now.size && was.pages === now.pages ? was : now));
          setProblem(null);
        } else {
          setMeta(null);
          setProblem(typeof json?.error === 'string' ? json.error : 'The file could not be read.');
        }
      } catch {
        if (!cancelled) setMeta((was) => was ?? null);
      }
    };
    void load(true);
    const timer = window.setInterval(() => void load(false), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [taskId, block.id, block.path]);

  const show = React.useRef<HTMLDivElement>(null);
  const present = () => { void show.current?.requestFullscreen?.().catch(() => {}); };

  const name = block.label || fileName(block.path);
  const ext = fileExt(block.path);
  const folder = fileFolder(block.path);
  const deck = meta?.kind === 'pdf' && meta.pages !== null;
  const pages = meta?.pages ?? 0;
  const at = Math.max(1, Math.min(Math.max(1, pages), page));
  const download = fileUrl(taskId, block.id, { raw: true, download: true });

  return (
    <div className="srf">
      <div className="srf-strip">{head}</div>
      <div className="srf-win">
        <div className="srf-head">
          <span className={`srf-tag${ext === 'pdf' ? ' pdf' : ''}`}>{ext || 'file'}</span>
          <b title={`~/.openclaw/workspace/${block.path}`}>{name}</b>
          {meta && <span className="srf-where">{deck ? `${pages} page${pages === 1 ? '' : 's'} · ` : ''}{fileSize(meta.size)} · saved {savedWhen(meta.mtime)}{folder ? ` · in ${folder}` : ''}</span>}
          <span className="sp" />
          {meta && <button type="button" className="srf-btn" onClick={onAsk} title="Opens the chat, with this file and page named in your message">Ask OpenClaw<span className="lbl">{deck ? 'to change this page' : 'to change this'}</span></button>}
          {deck && <button type="button" className="srf-btn" onClick={present} title="The page alone on the whole screen. Arrows or a press turn the pages; Escape leaves.">Present</button>}
          {meta && <a className="srf-btn" href={download} download={meta.name}>Download</a>}
          {deck && (
            <>
              <span className="srf-count">{at} / {pages}</span>
              <button type="button" className="srf-btn sq" onClick={() => onPage(at - 1)} disabled={at <= 1} aria-label="Previous page">‹</button>
              <button type="button" className="srf-btn sq" onClick={() => onPage(at + 1)} disabled={at >= pages} aria-label="Next page">›</button>
            </>
          )}
        </div>
        {meta === undefined ? <div className="srf-card"><p>Opening the file…</p></div>
          : meta === null ? (
            <div className="srf-card">
              <b>{name}</b>
              <p>{problem ?? 'The file could not be read just now.'}</p>
              <button type="button" className="srf-btn" onClick={onAsk}>Ask OpenClaw about it</button>
            </div>
          ) : deck ? <DeckView taskId={taskId} block={block} meta={meta} page={at} onPage={onPage} onNote={onNote} saving={saving} show={show} />
            : meta.kind === 'markdown' || meta.kind === 'text' ? <TextView url={fileUrl(taskId, block.id, { raw: true, v: meta.mtime })} markdown={meta.kind === 'markdown'} />
              : meta.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <div className="srf-pic"><img src={fileUrl(taskId, block.id, { raw: true, v: meta.mtime })} alt={name} /></div>
              ) : (
                <div className="srf-card">
                  <b>{meta.name}</b>
                  <p>{meta.kind === 'pdf' ? 'This PDF’s pages could not be drawn here.' : `A .${ext || 'file'} file cannot be shown here as it is.`} Download it to open it, or ask OpenClaw for a PDF of it.</p>
                  <a className="srf-btn" href={download} download={meta.name}>Download · {fileSize(meta.size)}</a>
                </div>
              )}
      </div>
    </div>
  );
}
