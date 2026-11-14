'use client';

// Sunrise: the home page's hero. Horizon Dawn's sky, where every task is a small form that says what it is, its
// name and its next step, the ones that matter most show a picture of the work, and pressing one opens the work
// right there. The engine (engine.ts) draws and lays everything out with three Handwired programs; this component
// loads the data, fills the engine's slots (the capture box, the trays, the workspace) and talks to the journal.
import React from 'react';
import { createPortal } from 'react-dom';
import { Instrument_Serif } from 'next/font/google';
import { QuickCaptureInput } from '@/components/quick-capture/QuickCaptureInput';
import { LetGoReasonModal } from '@/components/LetGoReasonModal';
import { DONE_CSS, DoneTray } from '@/components/horizon/DoneTray';
import { BRIEF_CSS } from '@/components/horizon/TaskBriefCard';
import { CHAT_CSS } from '@/components/horizon/BriefChat';
import { ActionCardView, CARD_CSS, type CardDecisionInput } from '@/components/horizon/ActionCardView';
import { decideCard, undoCard } from '@/components/horizon/card-actions';
import type { DawnSpace } from '@/components/horizon/dawn-space';
import { SPACE_CSS } from '@/components/horizon/space-css';
import { CARD_WHENS, type ActionCard, type CardAnswer, type FarSideView } from '@/lib/action-cards/types';
import { cardFormSpec, cardSalience } from '@/lib/sunrise/form-spec';
import { getCurrentDateISO } from '@/lib/current-date';
import { useRefresh } from '@/lib/RefreshContext';
import type { HorizonDaily } from '@/lib/horizon';
import type { SunriseData } from '@/lib/sunrise/data';
import { engineTaskId, parseTaskSearch, taskSearch, urlTaskId, type TaskTab } from '@/lib/task-link';
import type { DoneProposalRecord } from '@/app/api/tasks/done-proposals/store';
import type { DoneReceipt } from '@/app/api/tasks/done-at/apply';
import type { CardThing, SunriseEngine, TrayKind } from './engine';
import { SUNRISE_CSS } from './sunrise-css';
import { GLANCE_CSS } from './glance-css';
import { PANE_CSS, TaskPane } from './TaskPane';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });

// The journal's brief, chat and done components were drawn for Dawn's night sky; they read these.
const HERO_CSS = `
/* While a task's workspace is open, the page's floating Cedar button is not drawn over its chat composer. */
html[data-sr-workspace] [aria-label="Open Cedar chat (collapsed)"]{display:none!important}
/* On a phone the workspace is the whole screen (sunrise-css .sr-pane.full): the page under it is held still. */
@media (max-width:699px){html[data-sr-workspace],html[data-sr-workspace] body{overflow:hidden;overscroll-behavior:none}}
.sr-hero{--hz-ink:#f3efe7;--hz-dim:#a9b4c4;--hz-em:#ffd2a8;--hz-serif:var(--font-instrument-serif),'Instrument Serif',serif;--hz-sans:var(--font-geist-sans),Geist,sans-serif;--hz-mono:var(--font-geist-mono),'Geist Mono',monospace}
.sr-tray .sr-t{margin:0;font:400 22px/1.1 var(--serif)}
.sr-tray .sr-s{margin:4px 0 10px;color:#7a6656}
.sr-tray .sr-u{display:flex;align-items:center;gap:5px;padding:6px 0;border-top:1px solid #efe5d9;flex-wrap:wrap}
.sr-tray .sr-u>span{flex:1 1 150px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-tray .sr-u .sr-b,.sr-tray .sr-u input{padding:3px 8px;font-size:11.5px}
.sr-tray .sr-u input[type=date]{border:1px solid rgba(60,30,10,.2);border-radius:999px;background:#fff;color:#24140a;height:26px;font-family:var(--sans)}
.sr-tray .sr-list{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px}
.sr-tray .sr-list li.did{text-decoration:line-through;color:#9a8676}
.sr-tray label.daily{display:flex;gap:8px;align-items:center;padding:5px 0;cursor:pointer}
.sr-tray label.daily.did span{color:#9a8676}
.sr-tray .sr-err{margin:8px 0 0;color:#a3361a}
.sr-tray .sr-hold{display:grid;gap:6px;padding:8px 0;border-top:1px solid #efe5d9}
.sr-tray .sr-hold:first-of-type{border-top:0}
.sr-tray .sr-hold .sr-open{justify-self:start}
.sr-tray[data-kind=holds]{width:min(480px,calc(100% - 20px));background:#17120f;color:#f3efe7}
.sr-tray[data-kind=holds] .sr-s{color:#c9b8a6}
.sr-tray[data-kind=holds] .sr-hold{border-color:rgba(255,255,255,.12)}
.sr-tray[data-kind=holds] .sr-open{background:transparent;color:#ffd2a8;border-color:rgba(255,210,168,.5);padding:3px 11px;font-size:12px}
.hz-hold{display:inline-flex;align-items:center;gap:10px;border:1px solid #ff5a1f;background:#120a06;color:#ff8a5c;border-radius:999px;padding:4px 6px 4px 13px;font:600 12.5px var(--hz-sans)}
.hz-hold button{font:500 11px var(--hz-mono);color:#f3e3cf;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:2px 9px;cursor:pointer}
.hz-hold button:hover,.hz-hold button:focus-visible{border-color:#ffd2a8;outline:none}
.hz-hold button:disabled{opacity:.5;cursor:default}
.hz-hold .hz-letgo{background:transparent;border-color:rgba(255,255,255,.12);color:#c9b8a6}
.sr-tray .sr-card{display:grid;gap:1px;width:100%;text-align:left;padding:7px 2px;border:0;border-top:1px solid #efe5d9;background:none;cursor:pointer;color:inherit}
.sr-tray .sr-card:hover b{color:#b0521c}
.sr-tray .sr-card small{font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:#9a5a24}
.sr-tray .sr-card span{color:#7a6656;font-size:12px}
.sr-tray .sr-cards{max-height:320px;overflow:auto}
.sr-tray[data-kind=track] .sr-cards{max-height:min(360px,calc(var(--room,460px) - 100px))}
.sr-tray .sr-want{display:flex;gap:8px;align-items:baseline}
.sr-tray .sr-want b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-tray .sr-s code{font:11.5px var(--mono);color:#9a5a24}
.sr-tray .sr-answers li{line-height:1.35}
.sr-tray .sr-answers b.y{color:#b0521c}
.sr-tray .sr-answers b.n{color:#9a8676}
.sr-tray .sr-answers q{display:block;color:#7a6656;font-size:12px}
.sr-hero:has(.sr-sky.farside) .sr-enter3d{display:none}
.src{position:absolute;inset:0;overflow:auto;background:linear-gradient(180deg,#161b30,#090c18)}
.src .ac{position:static;width:100%;max-height:none;border:0;border-radius:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;background:none}
/* Stepping inside: Dawn's 3D world takes the sky over, and Sunrise's own layers step back until you leave. */
.sr-sky.hz-live{cursor:crosshair}
.sr-sky .sr-flat{transition:opacity .28s ease}
.sr-sky.hz-on3d .sr-flat{pointer-events:none}
.sr-sky.hz-on3d :is(.sr-labels,.sr-threads,.sr-arcs,.sr-sunbtn,.sr-ground,.sr-streak,.sr-day){opacity:0;visibility:hidden;transition:opacity .28s ease,visibility 0s .28s}
.sr-sky:not(.hz-settled) .hz3d-btns{pointer-events:none}
.sr-sky .hz3d-enter,.sr-enter3d{bottom:84px}
.sr-enter3d{position:absolute;right:24px;z-index:7;display:flex;align-items:center;gap:9px;font:500 13px var(--sans);color:#f3efe7;background:rgba(10,14,24,.55);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:8px 16px;cursor:pointer;transition:transform .2s ease,border-color .2s ease}
.sr-enter3d i{width:8px;height:8px;border-radius:50%;background:#ffd2a8;box-shadow:0 0 0 4px rgba(255,210,168,.2)}
.sr-enter3d:hover,.sr-enter3d:focus-visible{transform:translateY(-2px);border-color:#ffd2a8;outline:none}
.sr-enter3d:disabled{opacity:.6;cursor:default}
.sr-hero:has(.sr-sky.working) .sr-enter3d{display:none}
/* Once the 3D world has loaded, its own button takes this one's place: it follows the same rule. */
.sr-sky:is(.farside,.working):not(.hz-live) .hz3d-enter{display:none}
/* Full page: the hero fills the window and the rest of the page waits under it. Locked or full, the page does not scroll. */
.sr-hero.sr-fullpage{position:fixed;inset:0;z-index:60}
.sr-hero.sr-fullpage .sr-sky{height:100%}
html.sr-held{overflow:hidden}
.sr-undo{position:absolute;left:50%;bottom:104px;z-index:31;transform:translateX(-50%);display:inline-flex;align-items:center;gap:10px;font:12.5px var(--sans);color:#f3e3cf;background:rgba(10,14,24,.85);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:5px 6px 5px 13px;white-space:nowrap}
.sr-undo button{font:500 11px var(--mono);color:#ffd2a8;background:transparent;border:1px solid rgba(255,210,168,.4);border-radius:999px;padding:2px 9px;cursor:pointer}
/* ---- A phone. The 3D world is laid out for a wide screen and steered with a mouse and a wheel: a phone, which
   pans and pinches the sky itself, does without it. */
.sr-hero:has(.sr-sky.narrow) .sr-enter3d,.sr-sky.narrow .hz3d-enter{display:none}
/* Full page, the sky is under the status bar and over the home indicator: the words and the controls step clear. */
.sr-hero.sr-fullpage .sr-sky.narrow .sr-say{top:calc(14px + env(safe-area-inset-top,0px))}
.sr-hero.sr-fullpage .sr-sky.narrow .sr-ctl{top:calc(6px + env(safe-area-inset-top,0px))}
/* A tray is a sheet at the foot of the window (sunrise-css): its rows and buttons are a finger wide, and nothing in
   it is under 16px, so focusing a field does not zoom the page. The chat button steps aside while it, or a card, is up. */
@media (max-width:699px){html[data-sr-sheet] [aria-label="Open Cedar chat (collapsed)"]{display:none!important}}
.sr-sky.narrow .sr-tray .sr-u{gap:8px;padding:10px 0}
.sr-sky.narrow .sr-tray .sr-u>span{flex-basis:100%}
.sr-sky.narrow .sr-tray .sr-u .sr-b{position:relative;min-height:36px;padding:6px 13px;font-size:13px}
.sr-sky.narrow .sr-tray .sr-u .sr-b::after{content:'';position:absolute;inset:-4px -2px}
.sr-sky.narrow .sr-tray .sr-u input[type=date]{height:38px;padding:0 10px;font-size:16px}
.sr-sky.narrow .sr-tray .sr-card{min-height:44px;padding:9px 2px}
.sr-sky.narrow .sr-tray label.daily{min-height:44px}
.sr-sky.narrow .sr-tray label.daily input{width:20px;height:20px}
.sr-sky.narrow .sr-tray .sr-hold .sr-open{min-height:36px}
.sr-sky.narrow .sr-tray .hz-ask input{min-width:0;flex-basis:100%;height:40px;font-size:16px}
/* A card on a phone: its close and its reasons are a finger wide, and its reason field is 16px (no zoom on focus). */
.sr-sky.narrow .src .ac-x{position:relative;width:36px;height:36px}
.sr-sky.narrow .src .ac-x::after{content:'';position:absolute;inset:-4px}
.sr-sky.narrow .src .ac-rs button{min-height:36px;padding:7px 13px}
.sr-sky.narrow .src .ac-why input[type=text]{font-size:16px;padding:11px 12px}
.sr-sky.narrow .src .ac-outs label{min-height:44px}
.sr-sky.narrow .src .ac-ok{height:46px}
`;

const CARD_WHEN: Record<ActionCard['when'], string> = { now: 'Fits a Focus bet right now', period: 'Fine on a build day this period', after: 'Parked until after finals', someday: 'No date yet' };
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const dayFrom = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function SunriseHero() {
  const { taskRefreshCounter, refreshTasks } = useRefresh();
  const skyRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<SunriseEngine | null>(null);
  const [engine, setEngine] = React.useState<SunriseEngine | null>(null);
  const [data, setData] = React.useState<SunriseData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [tray, setTray] = React.useState<TrayKind | null>(null);
  const [trayError, setTrayError] = React.useState<string | null>(null);
  const [trayTrack, setTrayTrack] = React.useState<string | null>(null);
  const [proposals, setProposals] = React.useState<DoneProposalRecord[]>([]);
  const [undo, setUndo] = React.useState<{ text: string; run: () => Promise<unknown> } | null>(null);
  const undoTimer = React.useRef<number | null>(null);
  const [letGoAsk, setLetGoAsk] = React.useState<{ id: string; listType: string; short: string; title: string } | null>(null);
  const [tick, setTick] = React.useState(0);
  const [cards, setCards] = React.useState<ActionCard[]>([]);
  const [answers, setAnswers] = React.useState<CardAnswer[]>([]);
  const [cardsReady, setCardsReady] = React.useState(false);   // the first load of the cards has answered
  const cardsRef = React.useRef<ActionCard[]>([]);
  cardsRef.current = cards;
  // Dawn's 3D world, loaded (with three.js) the first time you step inside.
  const spaceRef = React.useRef<DawnSpace | null>(null);
  const [space, setSpace] = React.useState<'off' | 'loading' | 'on'>('off');
  const dataRef = React.useRef<SunriseData | null>(null);
  dataRef.current = data;
  const openRef = React.useRef<string | null>(null);
  openRef.current = open;

  // The open task lives in the address (/?task=<id>[&tab=brief|chat], lib/task-link): opening one pushes an entry,
  // so a phone's back gesture closes it, a reload brings it back and a link can open it. The engine says what is
  // open (onOpen) and the address follows it; back and forward drive the engine, and the address already agrees.
  const engineOpen = React.useRef<string | null>(null);   // what the engine last said is open
  // pushed: the entry naming the task was pushed here, so closing goes back to the one before it. backing: that
  // back is on its way. fromUrl: the engine is opening or closing what the address says.
  const urlState = React.useRef({ pushed: false, backing: false, fromUrl: false });
  const startTab = React.useRef<TaskTab | null>(null);   // the tab the address asked the opening task for
  const writeUrl = React.useCallback((id: string | null, tab: TaskTab | null, push: boolean) => {
    const { pathname, search, hash } = window.location;
    const next = `${pathname}${taskSearch(search, id === null ? null : urlTaskId(id), tab)}${hash}`;
    // No state of our own: Next's patched History copies its router state in and keeps its idea of the URL in step.
    if (push) window.history.pushState(null, '', next);
    else window.history.replaceState(null, '', next);
  }, []);
  const followOpen = React.useCallback((id: string | null) => {
    engineOpen.current = id;
    const u = urlState.current;
    if (!u.fromUrl) startTab.current = null;
    if (u.fromUrl || u.backing) return;   // the address says so already, or a back is on its way (popstate settles)
    const shown = parseTaskSearch(window.location.search).task;
    if ((id === null ? null : urlTaskId(id)) === shown) return;
    if (id === null) {
      if (u.pushed) { u.pushed = false; u.backing = true; window.history.back(); }
      else writeUrl(null, null, false);   // it was opened by the link the page loaded on: the address drops it
    } else if (shown !== null) writeUrl(id, null, false);   // one task to another (a related task): the same entry
    else { writeUrl(id, null, true); u.pushed = true; }
  }, [writeUrl]);
  const followTab = React.useCallback((tab: TaskTab) => {
    const id = engineOpen.current;
    if (id === null || id.startsWith('card:') || urlState.current.backing) return;
    const shown = parseTaskSearch(window.location.search);
    const next = tab === 'work' ? null : tab;
    if (shown.task === urlTaskId(id) && shown.tab !== next) writeUrl(id, next, false);   // tabs add no entries
  }, [writeUrl]);
  // Opens what the address names, if it is still open in the journal; otherwise the address drops it.
  const openFromUrl = React.useCallback(async (task: string, tab: TaskTab | null, pushed: boolean) => {
    const id = engineTaskId(task);
    const d = dataRef.current;
    const listed = id.startsWith('card:')
      ? cardsRef.current.some((card) => `card:${card.id}` === id)
      : !!d && (id in d.forms || d.today.some((t) => t.id === id && !t.completed)
        || [d.horizon.items, d.horizon.further, d.horizon.holds, d.horizon.undated, d.horizon.wants, ...Object.values(d.horizon.wantsBySection)]
          .some((list) => list.some((t) => t.id === id)));
    // A task further down a list than the sky shows: the brief knows every open task (and 404s the rest).
    const ok = listed || (!id.startsWith('card:') && await fetch(`/api/tasks/brief?id=${encodeURIComponent(id)}`)
      .then((r) => r.json()).then((json) => !!json?.success, () => false));
    const made = engineRef.current;
    // Only if the address still names it and nothing else was opened meanwhile.
    if (!made || parseTaskSearch(window.location.search).task !== task || engineOpen.current === id) return;
    if (!ok) { writeUrl(null, null, false); return; }
    const u = urlState.current;
    u.fromUrl = true;
    startTab.current = tab;
    try { made.openTask(id); } finally { u.fromUrl = false; }
    if (engineOpen.current === id) u.pushed = pushed;
  }, [writeUrl]);
  React.useEffect(() => {
    const onPop = () => {
      const u = urlState.current;
      const { task, tab } = parseTaskSearch(window.location.search);
      const want = task === null ? null : engineTaskId(task);
      if (u.backing) {
        u.backing = false;
        // Something was opened while the back was on its way: the address catches up with it.
        if (engineOpen.current !== null && want !== engineOpen.current) { writeUrl(engineOpen.current, null, true); u.pushed = true; }
        return;
      }
      const made = engineRef.current;
      if (!made || want === engineOpen.current) return;
      if (task === null) {
        u.fromUrl = true;
        try { made.closeTask(); } finally { u.fromUrl = false; }
        u.pushed = false;
        return;
      }
      // Forward onto an entry pushed here (or back onto one): the entry before it is the page without it.
      void openFromUrl(task, tab, true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [openFromUrl, writeUrl]);
  // A task's workspace has its own chat composer in the bottom right corner, where the page's floating "Chat with
  // Cedar" button sits on top of everything. While a workspace is open the page is told, and that button steps
  // aside (HERO_CSS).
  const workspaceOpen = open !== null && !open.startsWith('card:');
  React.useEffect(() => {
    if (!workspaceOpen) return;
    document.documentElement.setAttribute('data-sr-workspace', '');
    return () => document.documentElement.removeAttribute('data-sr-workspace');
  }, [workspaceOpen]);
  // So is a phone's tray, a sheet at the foot of the window where that button sits, and a card, which fills its sky.
  const sheetOpen = tray !== null || !!open?.startsWith('card:');
  React.useEffect(() => {
    if (!sheetOpen) return;
    document.documentElement.setAttribute('data-sr-sheet', '');
    return () => document.documentElement.removeAttribute('data-sr-sheet');
  }, [sheetOpen]);

  // The journal's data: on load, whenever tasks change anywhere on the page, and every five minutes.
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/tasks/sunrise')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) { setData(json.data as SunriseData); setError(null); }
        else setError(json.error || 'Could not load the horizon');
      })
      .catch(() => { if (!cancelled) setError('Could not load the horizon'); });
    return () => { cancelled = true; };
  }, [taskRefreshCounter, tick]);
  React.useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // The action cards: things OpenClaw noticed and posts he saved. They live on the far side of the sky (press
  // the sun), on rings by when they fit and in one slice per bet, as on Dawn.
  const loadCards = React.useCallback(() => {
    fetch('/api/action-cards')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return;
        const view = json.data as FarSideView;
        setCards(view.cards);
        setAnswers(view.answers);
      })
      .catch(() => {})
      .finally(() => setCardsReady(true));
  }, []);
  React.useEffect(() => { loadCards(); }, [loadCards, taskRefreshCounter, tick]);
  const cardThings = React.useMemo<CardThing[]>(() => cards
    .map((card) => ({
      id: `card:${card.id}`, salience: cardSalience(card), form: { spec: cardFormSpec(card), when: card.estimate },
      ring: CARD_WHENS.indexOf(card.when), slice: card.betLabel, noticed: card.source !== 'x', handed: card.status === 'handed',
    }))
    .sort((a, b) => b.salience - a.salience), [cards]);

  const loadProposals = React.useCallback(() => {
    fetch('/api/tasks/done-proposals')
      .then((r) => r.json())
      .then((json) => { if (json.success) setProposals(json.records as DoneProposalRecord[]); })
      .catch(() => {});
  }, []);
  React.useEffect(() => { loadProposals(); }, [loadProposals, taskRefreshCounter]);
  // While OpenClaw is answering "done, but when?", check back every few seconds.
  const thinking = proposals.some((p) => p.status === 'thinking');
  React.useEffect(() => {
    if (!thinking) return;
    const timer = window.setInterval(loadProposals, 3000);
    return () => window.clearInterval(timer);
  }, [thinking, loadProposals]);

  const toggleDaily = React.useCallback(async (daily: HorizonDaily) => {
    try {
      // `daily.done` is what it was before the press; say which way so a retry cannot flip it back.
      const json = await post('/api/tasks/today/complete', { taskId: daily.id, listType: daily.listType, date: getCurrentDateISO(), completed: !daily.done });
      if (!json?.success) {
        engineRef.current?.dailyFailed(daily.id);
        engineRef.current?.toast(`${daily.short}: ${json?.error || 'could not be updated'}`);
      }
    } catch {
      engineRef.current?.dailyFailed(daily.id);
      engineRef.current?.toast(`${daily.short} could not be updated: the Journal did not answer`);
    }
    refreshTasks();
  }, [refreshTasks]);
  // The 3D world stands its tasks where Sunrise's rings put them.
  const feedSpace = React.useCallback(() => {
    const layout = engineRef.current?.layoutForSpace();
    if (spaceRef.current && layout && dataRef.current) spaceRef.current.setLayout(layout.spots, dataRef.current.horizon, layout.sectors);
  }, []);
  const hostRef = React.useRef({ toggleDaily, feedSpace });
  hostRef.current = { toggleDaily, feedSpace };

  const stepInside = React.useCallback(async () => {
    const sky = skyRef.current, made = engineRef.current;
    if (!sky || !made || spaceRef.current) return;
    made.resetView();   // the 3D world takes the sky over at life size
    setSpace('loading');
    try {
      const { DawnSpace: Space } = await import('@/components/horizon/dawn-space');
      if (engineRef.current !== made) return;
      const world = new Space(sky, made.flat);
      spaceRef.current = world;
      // Flying to a task opens it; Escape closes what is open before it leaves the world.
      world.onArrive = (item) => made.openTask(item.id);
      world.onEscape = () => { if (!openRef.current) return false; made.closeTask(); return true; };
      world.onDailyToggle = (id) => {
        const daily = dataRef.current?.horizon.dailies.find((d) => d.id === id);
        if (daily) void hostRef.current.toggleDaily(daily);
      };
      hostRef.current.feedSpace();
      setSpace('on');
      sky.querySelector<HTMLButtonElement>('.hz3d-enter')?.click();
    } catch (err) {
      console.warn('Sunrise 3D unavailable:', err);
      setSpace('off');
      made.toast('The 3D view could not start here');
    }
  }, []);

  // The engine lives for the life of the component. It and the layout programs are loaded on demand, so building
  // them (most of a second) never holds up the page's first paint.
  React.useEffect(() => {
    let disposed = false;
    void import('./engine').then(async ({ SunriseEngine: Engine, loadPrograms }) => {
      const programs = await loadPrograms();
      if (disposed || !skyRef.current) return;
      const made = new Engine(skyRef.current, programs, {
        onOpen: (id) => { setOpen(id); followOpen(id); },
        onTray: (kind, track) => { setTray(kind); setTrayTrack(track ?? null); setTrayError(null); },
        onToggleDaily: (daily) => void hostRef.current.toggleDaily(daily),
        onLayout: () => hostRef.current.feedSpace(),
      });
      engineRef.current = made;
      setEngine(made);
    }).catch((err) => { console.error('Sunrise could not start:', err); if (!disposed) setError('Sunrise could not start'); });
    return () => {
      disposed = true;
      spaceRef.current?.destroy();
      spaceRef.current = null;
      setSpace('off');
      engineRef.current?.destroy();
      engineRef.current = null;
      setEngine(null);
    };
  }, []);
  React.useEffect(() => { if (engine && data) engine.update(data, cardThings, answers.length); }, [engine, data, cardThings, answers.length]);
  // A page loaded on /?task=<id> (a reload, or a link) opens it once the sky has its tasks and cards, and its fonts.
  const urlLoaded = React.useRef(false);
  React.useEffect(() => {
    if (urlLoaded.current || !engine || !data || !cardsReady) return;
    urlLoaded.current = true;
    const { task, tab } = parseTaskSearch(window.location.search);
    if (task === null || engineOpen.current !== null) return;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => openFromUrl(task, tab, false));
  }, [engine, data, cardsReady, openFromUrl]);

  const offerUndo = React.useCallback((text: string, run: () => Promise<unknown>) => {
    setUndo({ text, run });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  }, []);
  React.useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);
  const runUndo = React.useCallback(async () => {
    if (!undo) return;
    setUndo(null);
    await undo.run().catch(() => {});
    refreshTasks();
  }, [undo, refreshTasks]);

  const onDone = React.useCallback((short: string) => (receipt: DoneReceipt, label: string) => {
    offerUndo(`Done: ${short.replace(/[.…]+$/, '')} · ${label}.`, () => post('/api/tasks/done-at/undo', receipt));
    engineRef.current?.closeTray();
    refreshTasks();
  }, [offerUndo, refreshTasks]);

  // Let go: no longer worth doing. Not a completion. Asks why first; the reason is required.
  const letGo = React.useCallback(async (reason: string): Promise<string | void> => {
    if (!letGoAsk) return;
    const { id: taskId, listType, short } = letGoAsk;
    const json = await post('/api/tasks/let-go', { taskId, listType, reason }).catch(() => null);
    if (!json?.success) return json?.error || 'Could not let the task go.';
    setLetGoAsk(null);
    engineRef.current?.closeTray();
    engineRef.current?.closeTask();
    offerUndo(`Let go of ${short.replace(/[.…]+$/, '')}.`, () => post('/api/tasks/let-go/restore', { taskId }));
    refreshTasks();
  }, [letGoAsk, offerUndo, refreshTasks]);

  // Giving an undated task a When: it launches from the ground onto its ring.
  const setWhen = React.useCallback(async (taskId: string, short: string, dueDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
    setTrayError(null);
    const json = await post('/api/tasks/update', { taskId, listType: 'have-to-do', dueDate }).catch(() => null);
    if (!json?.success) { setTrayError(json?.error || 'That did not save. Try again.'); return; }
    engineRef.current?.closeTray();
    engineRef.current?.toast(`${short} → ${dueDate === dayFrom(0) ? 'today' : dueDate === dayFrom(1) ? 'tomorrow' : dueDate}`);
    refreshTasks();
  }, [refreshTasks]);

  // Answering a card always takes a reason. Agreeing can make it a task, which then rises on the rings.
  const decide = React.useCallback(async (card: ActionCard, d: CardDecisionInput): Promise<string | void> => {
    const decided = await decideCard(card, d);
    if (!decided.ok) return decided.error;
    engineRef.current?.closeTask();
    loadCards();
    refreshTasks();
    // A card that became a task rises on today's rings: the sky turns back to show it.
    if (d.verdict === 'agree' && d.outcome === 'task') engineRef.current?.turn(false);
    const said = d.verdict === 'agree'
      ? d.outcome === 'task' ? `Agreed. ${card.short} is a task now.` : d.outcome === 'hand' ? 'Agreed. OpenClaw is on it.' : `Agreed. ${decided.outcome?.label ?? ''}`
      : d.snooze ? 'Dismissed for now; it comes back later.' : 'Dismissed. OpenClaw keeps your reason.';
    offerUndo(said, async () => { await undoCard(card.id); loadCards(); });
  }, [loadCards, offerUndo, refreshTasks]);
  const openCard = open?.startsWith('card:') ? cards.find((card) => `card:${card.id}` === open) ?? null : null;

  const horizon = data?.horizon ?? null;
  const openTask = (id: string) => engineRef.current?.openTask(id);
  const section = tray === 'track' ? horizon?.wantTracks.find((t) => t.name === trayTrack) : undefined;
  const sectionWants = section ? horizon?.wantsBySection[section.name] ?? [] : [];

  const trayBody = !horizon || !data || !tray ? null : tray === 'holds' ? (
    <>
      <p className="sr-t">Overdue</p>
      <p className="sr-s">Done, but when? Or let it go.</p>
      {horizon.holds.map((h) => (
        <div key={h.id} className="sr-hold hz-row-b">
          <DoneTray
            target={{ id: h.id, listType: h.listType, short: h.short, title: h.title, due: h.due, implied: h.implied, left: h.left }}
            record={proposals.find((p) => p.taskId === h.id) ?? null}
            onLetGo={() => setLetGoAsk({ id: h.id, listType: h.listType, short: h.short, title: h.title })}
            onDone={onDone(h.short)}
            onChanged={loadProposals}
          />
          <button type="button" className="sr-b sr-open" onClick={() => openTask(h.id)}>Open it</button>
        </div>
      ))}
    </>
  ) : tray === 'nodate' ? (
    <>
      <p className="sr-t">No date yet</p>
      <p className="sr-s">Give one a When and it launches onto its ring.</p>
      {horizon.undated.map((u) => (
        <div key={u.id} className="sr-u">
          <span title={u.title}>{u.short}</span>
          <button type="button" className="sr-b" onClick={() => void setWhen(u.id, u.short, dayFrom(0))}>Today</button>
          <button type="button" className="sr-b" onClick={() => void setWhen(u.id, u.short, dayFrom(1))}>Tomorrow</button>
          <button type="button" className="sr-b" onClick={() => void setWhen(u.id, u.short, dayFrom(7))}>Next week</button>
          <input type="date" aria-label={`A date for ${u.short}`} min={dayFrom(0)} onChange={(e) => void setWhen(u.id, u.short, e.target.value)} />
          <button type="button" className="sr-b" onClick={() => openTask(u.id)}>Open</button>
        </div>
      ))}
      {trayError && <p className="sr-err" role="alert">{trayError}</p>}
    </>
  ) : tray === 'track' ? (
    // A section under the sun: every open task in it, in his queue's order. Press one to open it.
    <>
      <p className="sr-t">{section?.name ?? trayTrack}</p>
      {!section || section.open === 0 ? (
        <p className="sr-s">
          {section?.about ? `${section.about} ` : ''}Nothing here yet. Start a want-to-do task with <code>[{section?.name ?? trayTrack}]</code>, or list a project for {section?.name ?? trayTrack} in <code>tasks/want-tracks.json</code>.
        </p>
      ) : (
        <>
          <p className="sr-s">{section.about ? `${section.about} ` : ''}{sectionWants.length < section.open ? `The first ${sectionWants.length} of ${section.open} open, in your queue's order.` : `${section.open} open, in your queue's order.`}</p>
          <div className="sr-cards">
            {sectionWants.map((w, index) => (
              <button key={w.id} type="button" className="sr-card sr-want" title={w.title} onClick={() => openTask(w.id)}>
                <small>{index + 1}</small>
                <b>{w.title.replace(/^\s*\[[^\]]*\]\s*/, '') || w.short}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  ) : tray === 'answers' ? (
    <>
      <p className="sr-t">Your answers</p>
      <p className="sr-s">OpenClaw reads your reasons before it writes new cards.</p>
      <ul className="sr-list sr-answers">
        {answers.slice(0, 8).map((a) => (
          <li key={`${a.id}${a.at}`}><b className={a.verdict === 'agree' ? 'y' : 'n'}>{a.verdict === 'agree' ? '✓' : '✕'}</b> {a.short}<q>{a.reason}</q></li>
        ))}
      </ul>
    </>
  ) : tray === 'cards' ? (
    <>
      <p className="sr-t">To decide</p>
      <p className="sr-s">Things OpenClaw noticed and posts you saved. Agree or dismiss, with a reason.</p>
      <div className="sr-cards">
        {cards.slice().sort((a, b) => cardSalience(b) - cardSalience(a)).map((card) => (
          <button key={card.id} type="button" className="sr-card" onClick={() => openTask(`card:${card.id}`)}>
            <small>{card.kind} · {card.estimate}</small>
            <b>{card.short || card.title}</b>
            <span>{card.next}</span>
          </button>
        ))}
      </div>
    </>
  ) : tray === 'today' ? (
    <>
      <p className="sr-t">Today</p>
      <ul className="sr-list">
        {data.today.map((row) => <li key={row.id} className={row.completed ? 'did' : undefined}>{row.short}</li>)}
      </ul>
    </>
  ) : (
    <>
      <p className="sr-t">Dailies</p>
      {horizon.dailies.map((d) => (
        <label key={d.id} className={`daily${d.done ? ' did' : ''}`}>
          <input type="checkbox" checked={d.done} onChange={() => void toggleDaily(d)} /> <span>{d.short}</span>
        </label>
      ))}
    </>
  );

  // A "done, but when?" conversation whose task is no longer overdue on the ground still needs an answer.
  const waiting = horizon ? proposals.filter((p) => !horizon.holds.some((h) => h.id === p.taskId)) : [];

  return (
    <section className={`sr-hero ${serif.variable}`} aria-label="Sunrise: your tasks by how soon they are due">
      <style dangerouslySetInnerHTML={{ __html: SUNRISE_CSS + GLANCE_CSS + SPACE_CSS + DONE_CSS + BRIEF_CSS + CHAT_CSS + CARD_CSS + PANE_CSS + HERO_CSS }} />
      <div
        ref={skyRef}
        className="sr-sky"
        tabIndex={0}
        aria-label="Your tasks on rings by how soon they are due. Press a task to open it. Escape closes."
      />
      {!engine && <div className="sr-loading">{error || 'Loading your horizon…'}</div>}
      {engine && error && !data && <div className="sr-loading">{error}</div>}
      {engine && createPortal(<div onClick={(e) => e.stopPropagation()}><QuickCaptureInput variant="inline" /></div>, engine.slots.cap)}
      {engine && trayBody && createPortal(
        <>
          {/* Drawn only on a phone, where the tray is a sheet (sunrise-css). */}
          <button type="button" className="sr-x" aria-label="Close" onClick={() => engineRef.current?.closeTray()}>✕</button>
          {trayBody}
        </>,
        engine.slots.tray,
      )}
      {engine && openCard && createPortal(
        <div className="src">
          <ActionCardView
            key={openCard.id}
            card={openCard}
            where={`${CARD_WHEN[openCard.when]}. ${openCard.betLabel}.`}
            side="r"
            onClose={() => engineRef.current?.closeTask()}
            onDecide={(d) => decide(openCard, d)}
          />
        </div>,
        engine.slots.pane,
      )}
      {engine && open && !open.startsWith('card:') && data && createPortal(
        <TaskPane
          key={open}
          taskId={open}
          data={data}
          onClose={() => engineRef.current?.closeTask()}
          onGoto={openTask}
          onChanged={refreshTasks}
          onLetGo={(target) => setLetGoAsk(target)}
          onUndo={offerUndo}
          startTab={startTab.current ?? undefined}
          onTab={followTab}
        />,
        engine.slots.pane,
      )}
      {engine && data && space !== 'on' && (
        <button type="button" className="sr-enter3d" disabled={space === 'loading'} onClick={() => void stepInside()}>
          <i />{space === 'loading' ? 'Opening the 3D view…' : 'Step inside · explore in 3D'}
        </button>
      )}
      {undo && <span className="sr-undo" role="status">{undo.text}<button type="button" onClick={() => void runUndo()}>Undo</button></span>}
      {waiting.length > 0 && (
        <div className="hz-ground hz-keep" style={{ background: '#17120f', padding: '10px 16px', display: 'grid', gap: 8 }}>
          <div className="hz-row hz-row-b" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {waiting.map((p) => (
              <DoneTray
                key={p.id}
                target={{ id: p.taskId, listType: p.listType, short: p.short, title: p.title, due: p.due, implied: p.dueIsImplied }}
                record={p}
                onDone={onDone(p.short)}
                onChanged={loadProposals}
              />
            ))}
          </div>
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 70 }}>
        <LetGoReasonModal taskText={letGoAsk?.title ?? null} onCancel={() => setLetGoAsk(null)} onConfirm={letGo} />
      </div>
    </section>
  );
}
