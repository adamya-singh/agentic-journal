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

interface BrowserState {
  connections: Map<string, Promise<Connection>>;
  manualUntil: number;
}

// One server process, but each route bundle may load this module separately.
const globalState = globalThis as typeof globalThis & { __openclawBrowser?: BrowserState };
const state: BrowserState = (globalState.__openclawBrowser ??= { connections: new Map(), manualUntil: 0 });

export class OpenClawBrowserError extends Error {}

/** Adamya is using the browser: keep the worker from claiming new work for a little while. */
export function touchManualBrowserSession(now = Date.now()): void {
  state.manualUntil = now + MANUAL_SESSION_TTL_MS;
}

export function endManualBrowserSession(): void {
  state.manualUntil = 0;
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
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
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
  };
}

export type BrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
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
      const url = /^https?:\/\//i.test(input.url) ? input.url : `https://${input.url}`;
      await call(targetId, 'Page.navigate', { url });
      return;
    }
    case 'back': {
      const history = await call<{ currentIndex: number; entries: Array<{ id: number }> }>(targetId, 'Page.getNavigationHistory');
      const previous = history.entries[history.currentIndex - 1];
      if (previous) await call(targetId, 'Page.navigateToHistoryEntry', { entryId: previous.id });
      return;
    }
    case 'reload':
      await call(targetId, 'Page.reload');
      return;
  }
}
