import fs from 'node:fs';
import path from 'node:path';
import { backendDataDir, writeJsonFileAtomic } from './backend-data';
import { runOpenClawCli } from './openclaw-cron';

/**
 * Lets Adamya drive OpenClaw's own Chrome from the Journal, through the
 * DevTools protocol the browser already exposes on loopback. Same profile,
 * same cookies: a LinkedIn login or an account he creates here is what the
 * worker sees on its next run.
 */

const CDP_URL = (process.env.OPENCLAW_BROWSER_CDP_URL || 'http://127.0.0.1:18800').replace(/\/$/, '');
const CALL_TIMEOUT_MS = 15_000;
/** How long the worker stays paused after the last sign of Adamya at the wheel. */
const MANUAL_SESSION_TTL_MS = 2 * 60_000;

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

interface Connection {
  socket: WebSocket;
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
}

/** A file picker the page opened, caught so Adamya can answer it from the Journal. */
export interface FileChooserRequest {
  backendNodeId: number;
  mode: 'selectSingle' | 'selectMultiple';
}

interface BrowserState {
  connections: Map<string, Promise<Connection>>;
  fileChoosers: Map<string, FileChooserRequest>;
  manualUntil: number;
  /** Who holds the manual session (each viewer names itself) and until when; `manualUntil` is the latest. */
  holders?: Map<string, number>;
  /** When a viewer last ended its session, so a frame request already on its way does not start it again. */
  ended?: Map<string, number>;
  /** Tabs laid out for the space he views them in (setBrowserViewport), to be put back when he is done. */
  fitted?: Set<string>;
  fitWatch?: ReturnType<typeof setInterval>;
  /** Tabs the Journal itself opened (openBrowserUrl made a new one). Only these may be closed from the Journal. */
  made?: Set<string>;
}

// One server process, but each route bundle may load this module separately.
const globalState = globalThis as typeof globalThis & { __openclawBrowser?: BrowserState };
const state: BrowserState = (globalState.__openclawBrowser ??= { connections: new Map(), fileChoosers: new Map(), manualUntil: 0 });
state.fileChoosers ??= new Map();

export class OpenClawBrowserError extends Error {}

export type BrowserViewer = 'workspace' | 'application';
const END_GRACE_MS = 3_000;

/**
 * Adamya is using the browser: keep the worker from claiming new work for a little while. `viewer`
 * says which screen he is using it from; the task workspace and the application viewer can both
 * be open, and one closing must not take the browser from the other.
 */
export function touchManualBrowserSession(viewer: BrowserViewer = 'application', now = Date.now()): void {
  // A frame request that left the page just before he pressed Done arrives after it.
  if (now - (state.ended?.get(viewer) ?? 0) < END_GRACE_MS) return;
  (state.holders ??= new Map()).set(viewer, now + MANUAL_SESSION_TTL_MS);
  state.manualUntil = Math.max(state.manualUntil, now + MANUAL_SESSION_TTL_MS);
}

/**
 * Hands the browser back: closing our DevTools sessions also ends their
 * file-picker interception, so the worker's own uploads behave normally.
 * While another viewer still holds the session, only this viewer's hold ends.
 * Returns whether the session itself ended.
 */
export function endManualBrowserSession(viewer: BrowserViewer = 'application', now = Date.now()): boolean {
  (state.ended ??= new Map()).set(viewer, now);
  state.holders?.delete(viewer);
  const others = [...(state.holders?.values() ?? [])].filter((until) => until > now);
  if (others.length > 0) {
    state.manualUntil = Math.max(...others);
    return false;
  }
  state.holders?.clear();
  state.manualUntil = 0;
  state.fileChoosers.clear();
  for (const opening of state.connections.values()) {
    opening.then((connection) => connection.socket.close()).catch(() => undefined);
  }
  state.connections.clear();
  return true;
}

export function isManualBrowserSessionActive(now = Date.now()): boolean {
  return state.manualUntil > now;
}

async function listTargets(): Promise<CdpTarget[]> {
  const response = await fetch(`${CDP_URL}/json/list`, { cache: 'no-store' });
  if (!response.ok) throw new OpenClawBrowserError(`OpenClaw's browser answered ${response.status}`);
  return (await response.json()) as CdpTarget[];
}

async function pages(): Promise<CdpTarget[]> {
  try {
    return (await listTargets()).filter((target) => target.type === 'page');
  } catch {
    // Not running: start it once and look again.
    try {
      await runOpenClawCli(['browser', 'start'], 60_000);
      return (await listTargets()).filter((target) => target.type === 'page');
    } catch {
      throw new OpenClawBrowserError("OpenClaw's browser is not running and could not be started");
    }
  }
}

function comparable(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

/**
 * The tab to show for an application: the one already on its page (the worker
 * leaves it where it stopped, half-filled form and all), else a new tab there.
 */
export async function openBrowserTab(urls: string[]): Promise<string> {
  const wanted = urls.filter(Boolean);
  const open = await pages();
  const keys = wanted.map(comparable);
  const existing =
    open.find((target) => keys.includes(comparable(target.url))) ??
    open.find((target) => wanted.some((url) => hostOf(url) && hostOf(url) === hostOf(target.url)));
  let id = existing?.id;
  if (!id) {
    const target = wanted[0] ?? 'about:blank';
    const response = await fetch(`${CDP_URL}/json/new?${encodeURI(target)}`, { method: 'PUT' });
    if (!response.ok) throw new OpenClawBrowserError('Could not open a tab in OpenClaw’s browser');
    id = ((await response.json()) as CdpTarget).id;
  }
  await fetch(`${CDP_URL}/json/activate/${id}`).catch(() => undefined);
  return id;
}

export interface BrowserTab { id: string; url: string; title: string }
/** A tab as openBrowserUrl hands it back: `created` is true when the page was not open before and a tab was made for it. */
export interface OpenedBrowserTab extends BrowserTab { created: boolean }

/** The pages open in OpenClaw's browser right now. */
export async function listBrowserTabs(): Promise<BrowserTab[]> {
  return (await pages()).map(({ id, url, title }) => ({ id, url, title }));
}

/**
 * A tab on exactly this page: the one already open there (`samePage` decides, so OpenClaw's own tab on it is the
 * one he sees), else a new one. Unlike openBrowserTab it never borrows a tab that is merely on the same site.
 */
export async function openBrowserUrl(url: string, samePage: (a: string, b: string) => boolean): Promise<OpenedBrowserTab> {
  const open = await pages();
  let tab: BrowserTab | undefined = open.find((target) => samePage(target.url, url));
  const created = !tab;
  if (!tab) {
    const response = await fetch(`${CDP_URL}/json/new?${encodeURI(url)}`, { method: 'PUT' });
    if (!response.ok) throw new OpenClawBrowserError('Could not open a tab in OpenClaw’s browser');
    tab = (await response.json()) as CdpTarget;
    madeTabs().add(tab.id);
    saveMadeTabs();
  }
  await fetch(`${CDP_URL}/json/activate/${tab.id}`).catch(() => undefined);
  // A tab the Journal made earlier and found again is still the Journal's to close.
  return { id: tab.id, url: tab.url || url, title: tab.title, created: created || madeTabs().has(tab.id) };
}

/**
 * Brings a tab to the front of OpenClaw's browser. Chrome only paints the tab in front, so a tab he comes back
 * to after looking at another has no picture to give until it is in front again.
 */
export async function showBrowserTab(targetId: string): Promise<void> {
  const response = await fetch(`${CDP_URL}/json/activate/${encodeURIComponent(targetId)}`).catch(() => null);
  if (!response?.ok) throw new OpenClawBrowserError('That tab was closed');
}

/** One command to the browser itself (not a tab), over a connection opened for it and closed after. */
async function browserCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${CDP_URL}/json/version`, { cache: 'no-store' });
  if (!response.ok) throw new OpenClawBrowserError(`OpenClaw's browser answered ${response.status}`);
  const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!webSocketDebuggerUrl) throw new OpenClawBrowserError('OpenClaw’s browser did not say how to reach it');
  // Chrome reports its own loopback address; reach it the way CDP_URL does (a tunnel, another port).
  const address = new URL(webSocketDebuggerUrl);
  const base = new URL(CDP_URL);
  address.host = base.host;
  const socket = new WebSocket(address);
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new OpenClawBrowserError(`${method} timed out`)), CALL_TIMEOUT_MS);
      const fail = () => { clearTimeout(timer); reject(new OpenClawBrowserError('Could not reach OpenClaw’s browser')); };
      socket.addEventListener('error', fail, { once: true });
      socket.addEventListener('close', fail, { once: true });
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })), { once: true });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error) reject(new OpenClawBrowserError(message.error.message));
        else resolve(message.result as T);
      });
    });
  } finally {
    socket.close();
  }
}

/**
 * Closes a tab the Journal opened. A tab that was already open when the Journal first showed its page (OpenClaw's
 * own, or one he opened there by hand) is never closed from here: it is refused, and `false` comes back. A tab
 * that is already gone counts as closed.
 */
export async function closeBrowserTab(targetId: string): Promise<boolean> {
  if (!madeTabs().has(targetId)) return false;
  state.fitted?.delete(targetId);
  state.fileChoosers.delete(targetId);
  const connection = state.connections.get(targetId);
  state.connections.delete(targetId);
  connection?.then((open) => open.socket.close()).catch(() => undefined);
  try {
    await browserCall<{ success?: boolean }>('Target.closeTarget', { targetId });
  } catch (error) {
    // Still the Journal's tab: it stays on the list, so closing it can be tried again.
    if (!(error instanceof OpenClawBrowserError) || !/No target with given id/i.test(error.message)) throw error;
  }
  madeTabs().delete(targetId);
  saveMadeTabs();
  return true;
}

// The tabs the Journal opened are kept on disk as well: every deploy restarts the server, and a
// tab it had opened before could then never be closed from the Journal again.
const madeTabsFile = () => path.join(backendDataDir(), 'openclaw-browser', 'journal-tabs.json');
function madeTabs(): Set<string> {
  if (state.made) return state.made;
  let ids: unknown = [];
  try {
    ids = (JSON.parse(fs.readFileSync(madeTabsFile(), 'utf8')) as { tabs?: unknown }).tabs;
  } catch {
    /* No file yet, or unreadable: start empty. */
  }
  state.made = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  return state.made;
}
function saveMadeTabs(): void {
  try {
    // Chrome forgets its tabs when it restarts; 200 ids is far more than can be open.
    writeJsonFileAtomic(madeTabsFile(), { tabs: [...madeTabs()].slice(-200) });
  } catch (error) {
    console.error('Could not save the list of tabs the Journal opened:', error);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function connect(targetId: string): Promise<Connection> {
  const cached = state.connections.get(targetId);
  if (cached) return cached;
  const opening = (async () => {
    const target = (await pages()).find((candidate) => candidate.id === targetId);
    if (!target?.webSocketDebuggerUrl) throw new OpenClawBrowserError('That tab was closed');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const connection: Connection = { socket, nextId: 1, pending: new Map() };
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new OpenClawBrowserError('Could not reach that tab')), { once: true });
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>;
      };
      if (message.method === 'Page.fileChooserOpened' && typeof message.params?.backendNodeId === 'number') {
        state.fileChoosers.set(targetId, {
          backendNodeId: message.params.backendNodeId,
          mode: message.params.mode === 'selectMultiple' ? 'selectMultiple' : 'selectSingle',
        });
        return;
      }
      const waiter = message.id === undefined ? undefined : connection.pending.get(message.id);
      if (!waiter) return;
      connection.pending.delete(message.id!);
      if (message.error) waiter.reject(new OpenClawBrowserError(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      state.connections.delete(targetId);
      for (const waiter of connection.pending.values()) waiter.reject(new OpenClawBrowserError('The tab went away'));
      connection.pending.clear();
    });
    // Catch file pickers instead of letting a native dialog open on the laptop's screen.
    for (const [method, params] of [['Page.enable', {}], ['Page.setInterceptFileChooserDialog', { enabled: true }]] as const) {
      socket.send(JSON.stringify({ id: connection.nextId++, method, params }));
    }
    return connection;
  })();
  state.connections.set(targetId, opening);
  opening.catch(() => state.connections.delete(targetId));
  return opening;
}

async function call<T>(targetId: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const connection = await connect(targetId);
  const id = connection.nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.pending.delete(id);
      reject(new OpenClawBrowserError(`${method} timed out`));
    }, CALL_TIMEOUT_MS);
    connection.pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value as T); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    connection.socket.send(JSON.stringify({ id, method, params }));
  });
}

export interface BrowserFrame {
  jpeg: Buffer;
  url: string;
  title: string;
  width: number;
  height: number;
  fileChooser?: FileChooserRequest['mode'];
}

export async function captureBrowserFrame(targetId: string): Promise<BrowserFrame> {
  const [shot, metrics, info] = await Promise.all([
    call<{ data: string }>(targetId, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 }),
    call<{ cssVisualViewport: { clientWidth: number; clientHeight: number } }>(targetId, 'Page.getLayoutMetrics'),
    call<{ targetInfo: { url: string; title: string } }>(targetId, 'Target.getTargetInfo', { targetId }),
  ]);
  return {
    jpeg: Buffer.from(shot.data, 'base64'),
    url: info.targetInfo.url,
    title: info.targetInfo.title,
    width: Math.round(metrics.cssVisualViewport.clientWidth),
    height: Math.round(metrics.cssVisualViewport.clientHeight),
    ...(state.fileChoosers.has(targetId) ? { fileChooser: state.fileChoosers.get(targetId)!.mode } : {}),
  };
}

/** Puts files (absolute paths on this machine) into the picker the page opened, or dismisses it. */
export async function answerFileChooser(targetId: string, files: string[]): Promise<void> {
  const chooser = state.fileChoosers.get(targetId);
  if (!chooser) throw new OpenClawBrowserError('The page is not asking for a file');
  state.fileChoosers.delete(targetId);
  if (files.length === 0) return;
  await call(targetId, 'DOM.setFileInputFiles', {
    files: chooser.mode === 'selectSingle' ? files.slice(0, 1) : files,
    backendNodeId: chooser.backendNodeId,
  });
}

/**
 * Lays the page out for a window this size, so it fits the space he is viewing it in, or (null) gives the tab its
 * own window size back. Chrome keeps the size until it is told otherwise, so every tab sized here is remembered
 * and put back when he is done: when the session is ended (resetBrowserViewports), or by itself once he has not
 * looked at the browser for a while and the manual session has lapsed.
 */
export async function setBrowserViewport(targetId: string, size: { width: number; height: number } | null): Promise<void> {
  const fitted = (state.fitted ??= new Set());
  if (size === null) {
    // Forgotten only once Chrome has given the size back; a failed call is retried by the watch.
    await call(targetId, 'Emulation.clearDeviceMetricsOverride');
    fitted.delete(targetId);
    return;
  }
  await call(targetId, 'Emulation.setDeviceMetricsOverride', {
    width: Math.round(size.width), height: Math.round(size.height), deviceScaleFactor: 0, mobile: false,
  });
  fitted.add(targetId);
  watchFitted();
}

function watchFitted(): void {
  if (state.fitWatch) return;
  state.fitWatch = setInterval(() => { if (!isManualBrowserSessionActive()) void resetBrowserViewports(); }, 30_000);
  state.fitWatch.unref?.();
}

/** Gives every tab sized by setBrowserViewport its own window size back. Call before ending the manual session. */
export async function resetBrowserViewports(): Promise<void> {
  const fitted = [...(state.fitted ?? [])];
  state.fitted?.clear();
  if (state.fitWatch) { clearInterval(state.fitWatch); state.fitWatch = undefined; }
  const results = await Promise.allSettled(fitted.map((targetId) => call(targetId, 'Emulation.clearDeviceMetricsOverride')));
  const failed = fitted.filter((_, index) => results[index].status === 'rejected');
  if (failed.length === 0) return;
  // A tab that is still open and still sized for the Journal is tried again; one that has closed
  // has nothing left to put back. If the browser cannot be reached, all of them are kept.
  const open = await pages().then((tabs) => new Set(tabs.map((tab) => tab.id)), () => null);
  const retry = failed.filter((targetId) => !open || open.has(targetId));
  if (retry.length === 0) return;
  for (const targetId of retry) (state.fitted ??= new Set()).add(targetId);
  watchFitted();
}

export type BrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' };

const SPECIAL_KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
};

export async function sendBrowserInput(targetId: string, input: BrowserInput): Promise<void> {
  switch (input.type) {
    case 'click':
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await call(targetId, 'Input.dispatchMouseEvent', {
          type, x: input.x, y: input.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1,
        });
      }
      return;
    case 'scroll':
      await call(targetId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: input.x, y: input.y, deltaX: 0, deltaY: input.deltaY,
      });
      return;
    case 'text':
      await call(targetId, 'Input.insertText', { text: input.text });
      return;
    case 'key': {
      const modifiers = (input.alt ? 1 : 0) | (input.ctrl ? 2 : 0) | (input.meta ? 4 : 0) | (input.shift ? 8 : 0);
      const special = SPECIAL_KEYS[input.key];
      const letter = /^[a-z0-9]$/i.test(input.key) ? input.key.toUpperCase() : null;
      if (!special && !letter) throw new OpenClawBrowserError(`Unsupported key: ${input.key}`);
      const keyCode = special?.keyCode ?? letter!.charCodeAt(0);
      const code = special?.code ?? (/\d/.test(letter!) ? `Digit${letter}` : `Key${letter}`);
      const text = modifiers & 6 ? undefined : special?.text;
      await call(targetId, 'Input.dispatchKeyEvent', {
        type: text ? 'keyDown' : 'rawKeyDown', key: input.key, code, windowsVirtualKeyCode: keyCode, modifiers,
        ...(text ? { text } : {}),
      });
      await call(targetId, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: input.key, code, windowsVirtualKeyCode: keyCode, modifiers,
      });
      return;
    }
    case 'navigate': {
      state.fileChoosers.delete(targetId);
      const url = /^([a-z][a-z0-9+.-]*:\/\/|about:|data:)/i.test(input.url) ? input.url : `https://${input.url}`;
      await call(targetId, 'Page.navigate', { url });
      return;
    }
    case 'back': {
      const history = await call<{ currentIndex: number; entries: Array<{ id: number }> }>(targetId, 'Page.getNavigationHistory');
      const previous = history.entries[history.currentIndex - 1];
      if (previous) await call(targetId, 'Page.navigateToHistoryEntry', { entryId: previous.id });
      return;
    }
    case 'forward': {
      const history = await call<{ currentIndex: number; entries: Array<{ id: number }> }>(targetId, 'Page.getNavigationHistory');
      const following = history.entries[history.currentIndex + 1];
      if (following) await call(targetId, 'Page.navigateToHistoryEntry', { entryId: following.id });
      return;
    }
    case 'reload':
      await call(targetId, 'Page.reload');
      return;
  }
}
