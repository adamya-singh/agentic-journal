import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { backendDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { parseJsonObjectOutput, runOpenClawCli } from '@/lib/openclaw-cron';
import {
  addCronRun,
  addEventNotesToDays,
  addNote,
  addSample,
  addSegmentsToDays,
  buildBars,
  classifyUnitMessage,
  combineBars,
  formatClock,
  localDateKey,
  recentDateKeys,
  unionTimeline,
  windowUptime,
  worstStatus,
  type BootWindow,
  type ComponentStatus,
  type DayBar,
  type DayMap,
  type UnitEvent,
} from './history';

/**
 * The uptime monitor: probes every piece of the Agentic Journal stack, keeps
 * per-day history in src/backend/data/uptime/history.json, and builds the
 * Statuspage-style view. History comes from the most trustworthy source per
 * component: journald for systemd units (it still knows about downtime that
 * happened while this server was down), OpenClaw's run log for cron jobs, and
 * this monitor's own samples for everything else.
 */

export const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const WINDOW_DAYS = 90;
const RETAIN_DAYS = 120;
/** A gap longer than this between samples is "no data", not observed time. */
const MAX_SAMPLE_GAP_MS = 2 * SAMPLE_INTERVAL_MS;
const SLOW_RESPONSE_MS = 3000;
const PUBLIC_ORIGIN = process.env.AGENTIC_JOURNAL_ORIGIN || 'https://ubuntu-laptop.taile85e97.ts.net';

type HistorySource = 'journal' | 'samples' | 'runs';

interface ComponentDef {
  id: string;
  group: string;
  name: string;
  description: string;
  history: HistorySource;
  units?: string[];
  userUnits?: boolean;
}

interface CurrentCheck {
  status: ComponentStatus;
  detail: string;
  checkedAt: number;
}

interface CronJobMeta {
  id: string;
  name: string;
  description?: string;
}

interface UptimeStore {
  version: 1;
  samples: Record<string, DayMap>;
  journal: Record<string, DayMap>;
  runs: Record<string, DayMap>;
  cronCursor: Record<string, number>;
  cronJobs: CronJobMeta[];
  current: Record<string, CurrentCheck>;
  lastSampleAt?: number;
}

export interface UptimeComponentView {
  id: string;
  name: string;
  description: string;
  status: ComponentStatus;
  detail: string;
  uptime: number | null;
  bars: DayBar[];
}

export interface UptimeGroupView {
  id: string;
  name: string;
  status: ComponentStatus;
  uptime: number | null;
  bars: DayBar[];
  components: UptimeComponentView[];
}

export interface UptimeView {
  generatedAt: string;
  checkedAt: string | null;
  overall: ComponentStatus;
  windowDays: number;
  groups: UptimeGroupView[];
}

const GROUPS = [
  { id: 'app', name: 'Journal App' },
  { id: 'workers', name: 'Background Workers' },
  { id: 'openclaw', name: 'OpenClaw' },
  { id: 'automations', name: 'Automations' },
  { id: 'host', name: 'Host' },
] as const;

const STATIC_COMPONENTS: ComponentDef[] = [
  {
    id: 'web',
    group: 'app',
    name: 'Web app',
    description: 'Next.js on 127.0.0.1:3000, production or development mode',
    history: 'journal',
    units: ['agentic-journal.service', 'agentic-journal-dev.service'],
  },
  {
    id: 'mastra',
    group: 'app',
    name: 'Journal agent (Mastra)',
    description: 'Chat agent backend on 127.0.0.1:4111',
    history: 'samples',
  },
  {
    id: 'tailnet',
    group: 'app',
    name: 'Tailnet HTTPS access',
    description: `${PUBLIC_ORIGIN} through Tailscale Serve`,
    history: 'samples',
  },
  {
    id: 'omi-worker',
    group: 'workers',
    name: 'Omi transcription worker',
    description: 'Transcribes Omi audio into journal transcripts',
    history: 'journal',
    units: ['agentic-journal-omi-worker.service'],
  },
  {
    id: 'bookmarks-worker',
    group: 'workers',
    name: 'X bookmarks worker',
    description: 'Runs requested X bookmark imports',
    history: 'journal',
    units: ['agentic-journal-bookmarks-worker.service'],
  },
  {
    id: 'media-worker',
    group: 'workers',
    name: 'IMDb media worker',
    description: 'IMDb sync and requested watchlist updates',
    history: 'journal',
    units: ['agentic-journal-media-worker.service'],
  },
  {
    id: 'gateway',
    group: 'openclaw',
    name: 'Gateway',
    description: 'OpenClaw gateway that runs agents and automations',
    history: 'journal',
    units: ['openclaw-gateway.service'],
    userUnits: true,
  },
  {
    id: 'telegram',
    group: 'openclaw',
    name: 'Telegram channel',
    description: 'Chat channel used for reminders and failure alerts',
    history: 'samples',
  },
  {
    id: 'browser',
    group: 'openclaw',
    name: 'Managed browser',
    description: 'Chrome profile used by job applications, Canvas and ChatGPT Web',
    history: 'journal',
    units: ['openclaw-browser.service'],
    userUnits: true,
  },
  {
    id: 'vnc',
    group: 'openclaw',
    name: 'Remote desktop (VNC)',
    description: 'Shares the physical desktop for watching the browser',
    history: 'journal',
    units: ['openclaw-x0vnc.service'],
    userUnits: true,
  },
  {
    id: 'disk',
    group: 'host',
    name: 'Disk space',
    description: 'Free space on the journal data volume',
    history: 'samples',
  },
  {
    id: 'memory',
    group: 'host',
    name: 'Memory',
    description: 'Available RAM; low memory gets builds and agents OOM-killed',
    history: 'samples',
  },
];

function storePath(): string {
  return path.join(backendDataDir(), 'uptime', 'history.json');
}

function emptyStore(): UptimeStore {
  return { version: 1, samples: {}, journal: {}, runs: {}, cronCursor: {}, cronJobs: [], current: {} };
}

function readStore(): UptimeStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf-8')) as Partial<UptimeStore>;
    return { ...emptyStore(), ...parsed, version: 1 };
  } catch {
    return emptyStore();
  }
}

function cronComponentId(jobId: string): string {
  return `cron:${jobId}`;
}

function componentDefs(store: UptimeStore): ComponentDef[] {
  return [
    ...STATIC_COMPONENTS,
    ...store.cronJobs.map((job) => ({
      id: cronComponentId(job.id),
      group: 'automations',
      name: job.name,
      description: job.description ?? 'OpenClaw automation',
      history: 'runs' as const,
    })),
  ];
}

// --- command helpers ---------------------------------------------------------

/**
 * systemd services get no login session, so `systemctl --user` / `journalctl
 * --user` can't find the user manager unless we point them at its runtime dir.
 */
function userSessionEnv(): NodeJS.ProcessEnv {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
  return {
    ...process.env,
    XDG_RUNTIME_DIR: runtimeDir,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtimeDir}/bus`,
  };
}

/** Runs a command and returns stdout even when it exits non-zero (systemctl is-active does). */
function runQuiet(command: string, args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: userSessionEnv() }, (_error, stdout) => {
      resolve(typeof stdout === 'string' ? stdout : '');
    });
  });
}

async function unitStates(units: string[], user: boolean): Promise<Map<string, string>> {
  const output = await runQuiet('systemctl', [...(user ? ['--user'] : []), 'is-active', ...units]);
  const lines = output.trim().split('\n');
  return new Map(units.map((unit, index) => [unit, lines[index]?.trim() || 'unknown']));
}

function statusFromUnitState(state: string): ComponentStatus {
  if (state === 'active') return 'operational';
  if (state === 'activating' || state === 'reloading' || state === 'deactivating') return 'degraded';
  if (state === 'inactive' || state === 'failed') return 'major';
  return 'unknown';
}

async function httpProbe(url: string): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer().catch(() => undefined);
    const ms = Date.now() - started;
    return { ok: response.ok, ms, detail: response.ok ? `Responded in ${ms} ms` : `HTTP ${response.status}` };
  } catch (error) {
    const ms = Date.now() - started;
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'Timed out' : 'Not reachable';
    return { ok: false, ms, detail: reason };
  }
}

function fromHttp(result: { ok: boolean; ms: number; detail: string }): Omit<CurrentCheck, 'checkedAt'> {
  if (!result.ok) return { status: 'major', detail: result.detail };
  if (result.ms > SLOW_RESPONSE_MS) return { status: 'degraded', detail: `Slow: ${result.detail.toLowerCase()}` };
  return { status: 'operational', detail: result.detail };
}

// --- probes -----------------------------------------------------------------------

type Checks = Record<string, Omit<CurrentCheck, 'checkedAt'>>;

async function probeSystemdComponents(checks: Checks): Promise<void> {
  const systemUnits = STATIC_COMPONENTS.filter((c) => c.units && !c.userUnits).flatMap((c) => c.units!);
  const userUnits = STATIC_COMPONENTS.filter((c) => c.units && c.userUnits).flatMap((c) => c.units!);
  const [system, user] = await Promise.all([unitStates(systemUnits, false), unitStates(userUnits, true)]);
  for (const def of STATIC_COMPONENTS) {
    if (!def.units || def.id === 'web') continue;
    const state = (def.userUnits ? user : system).get(def.units[0]) ?? 'unknown';
    const status = statusFromUnitState(state);
    checks[def.id] = { status, detail: status === 'operational' ? 'Running' : `Service is ${state}` };
  }
  const prod = system.get('agentic-journal.service');
  const dev = system.get('agentic-journal-dev.service');
  const web = fromHttp(await httpProbe('http://127.0.0.1:3000/favicon.ico'));
  const mode = prod === 'active' ? 'Production' : dev === 'active' ? 'Development mode' : null;
  checks.web = {
    status: web.status,
    detail: web.status === 'major' ? `${web.detail}; production ${prod}, dev ${dev}` : `${mode ?? 'Running'} · ${web.detail}`,
  };
}

async function probeHttpComponents(checks: Checks): Promise<void> {
  const [mastra, tailnet, tailscale] = await Promise.all([
    httpProbe('http://127.0.0.1:4111/'),
    httpProbe(`${PUBLIC_ORIGIN}/favicon.ico`),
    runQuiet('tailscale', ['status', '--json']),
  ]);
  checks.mastra = fromHttp(mastra);
  const parsed = parseJsonObjectOutput(tailscale) as { BackendState?: string; Self?: { Online?: boolean } } | null;
  if (!parsed || parsed.BackendState !== 'Running') {
    checks.tailnet = { status: 'major', detail: `Tailscale is ${parsed?.BackendState ?? 'not responding'}` };
  } else if (parsed.Self?.Online === false) {
    checks.tailnet = { status: 'major', detail: 'This machine is offline on the tailnet' };
  } else {
    checks.tailnet = fromHttp(tailnet);
  }
}

async function probeGateway(checks: Checks): Promise<void> {
  let health: Record<string, unknown> | null = null;
  try {
    health = parseJsonObjectOutput(await runOpenClawCli(['health', '--json'], 30_000));
  } catch {
    health = null;
  }
  if (!health || health.ok !== true) {
    if (checks.gateway?.status === 'operational') {
      checks.gateway = { status: 'partial', detail: 'Service is running but health checks fail' };
    }
    checks.telegram = { status: 'unknown', detail: 'Gateway health is unavailable' };
    return;
  }
  const eventLoop = health.eventLoop as { degraded?: boolean; reasons?: string[] } | undefined;
  if (eventLoop?.degraded && checks.gateway?.status === 'operational') {
    checks.gateway = { status: 'degraded', detail: `Event loop degraded: ${(eventLoop.reasons ?? []).join(', ') || 'busy'}` };
  }
  const channels = health.channels as Record<string, { lifecycle?: string; enabled?: boolean; lastConnectedAt?: number }> | undefined;
  const telegram = channels?.telegram;
  if (!telegram || telegram.enabled === false) {
    checks.telegram = { status: 'paused', detail: 'Channel is disabled' };
  } else if (telegram.lifecycle === 'ready') {
    checks.telegram = { status: 'operational', detail: 'Connected' };
  } else {
    checks.telegram = { status: 'partial', detail: `Channel is ${telegram.lifecycle ?? 'not ready'}` };
  }
}

interface RawCronJob {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  schedule?: { kind?: string };
  state?: {
    lastRunAtMs?: number;
    lastRunStatus?: string;
    consecutiveErrors?: number;
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastError?: string;
  };
}

async function probeCron(store: UptimeStore, checks: Checks, now: number): Promise<void> {
  let jobs: RawCronJob[];
  try {
    const parsed = parseJsonObjectOutput(await runOpenClawCli(['cron', 'list', '--all', '--json'], 30_000));
    if (!parsed || !Array.isArray(parsed.jobs)) throw new Error('No job list');
    jobs = parsed.jobs as RawCronJob[];
  } catch {
    for (const job of store.cronJobs) {
      checks[cronComponentId(job.id)] = { status: 'unknown', detail: 'Could not read automations from the gateway' };
    }
    return;
  }
  // One-shot reminders aren't services; only recurring automations get a row.
  const recurring = jobs.filter((job) => job.id && job.name && job.schedule?.kind !== 'at');
  store.cronJobs = recurring.map((job) => ({
    id: job.id!,
    name: job.displayName || job.name!,
    description: job.description,
  }));
  for (const job of recurring) {
    const id = cronComponentId(job.id!);
    const state = job.state ?? {};
    const lastRun = state.lastRunAtMs ? ` · last run ${formatAgo(now - state.lastRunAtMs)}` : '';
    if (!job.enabled) {
      checks[id] = { status: 'paused', detail: 'Paused' };
    } else if ((state.consecutiveErrors ?? 0) >= 3) {
      checks[id] = { status: 'major', detail: `${state.consecutiveErrors} runs in a row failed${lastRun}` };
    } else if (state.lastRunStatus === 'error') {
      checks[id] = { status: 'partial', detail: `Last run failed${lastRun}` };
    } else if (!state.runningAtMs && state.nextRunAtMs && now - state.nextRunAtMs > 15 * 60 * 1000) {
      checks[id] = { status: 'degraded', detail: `Overdue since ${formatClock(state.nextRunAtMs)}` };
    } else {
      checks[id] = { status: 'operational', detail: state.runningAtMs ? 'Running now' : `OK${lastRun}` };
    }
    await syncCronRuns(store, job);
  }
}

/** Pulls runs newer than the cursor so history outlives OpenClaw's capped run log. */
async function syncCronRuns(store: UptimeStore, job: RawCronJob): Promise<void> {
  const cursor = store.cronCursor[job.id!] ?? 0;
  if (!job.state?.lastRunAtMs || job.state.lastRunAtMs <= cursor) return;
  const id = cronComponentId(job.id!);
  const days = (store.runs[id] ??= {});
  // The gateway caps a page at 200; the first sync backfills what OpenClaw still keeps.
  const pageSize = 200;
  const maxPages = cursor ? 3 : 10;
  let newest = cursor;
  for (let page = 0; page < maxPages; page += 1) {
    let parsed: Record<string, unknown> | null;
    try {
      parsed = parseJsonObjectOutput(
        await runOpenClawCli(
          ['cron', 'runs', '--id', job.id!, '--limit', String(pageSize), '--offset', String(page * pageSize), '--sort', 'desc'],
          60_000,
        ),
      );
    } catch {
      return;
    }
    const entries = Array.isArray(parsed?.entries) ? (parsed!.entries as Record<string, unknown>[]) : [];
    let reachedCursor = false;
    for (const entry of entries) {
      const ts = typeof entry.ts === 'number' ? entry.ts : 0;
      if (ts <= cursor) {
        reachedCursor = true;
        break;
      }
      if (entry.action !== 'finished') continue;
      newest = Math.max(newest, ts);
      addCronRun(days, {
        at: typeof entry.runAtMs === 'number' ? entry.runAtMs : ts,
        status: String(entry.status ?? 'ok'),
        error: typeof entry.error === 'string' ? entry.error : undefined,
      });
    }
    if (reachedCursor || parsed?.hasMore !== true) break;
  }
  store.cronCursor[job.id!] = newest;
}

function probeHost(checks: Checks): void {
  try {
    const stats = fs.statfsSync(backendDataDir());
    const free = stats.bavail / stats.blocks;
    const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
    const detail = `${freeGb.toFixed(0)} GB free (${Math.round(free * 100)}%)`;
    checks.disk = { status: free < 0.03 ? 'major' : free < 0.1 ? 'degraded' : 'operational', detail };
  } catch {
    checks.disk = { status: 'unknown', detail: 'Could not read the data volume' };
  }
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    const read = (key: string) => Number(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024;
    const total = read('MemTotal');
    const available = read('MemAvailable');
    const ratio = total ? available / total : 0;
    const detail = `${(available / 1024 ** 3).toFixed(1)} of ${(total / 1024 ** 3).toFixed(1)} GB available`;
    checks.memory = { status: ratio < 0.05 ? 'partial' : ratio < 0.12 ? 'degraded' : 'operational', detail };
  } catch {
    checks.memory = { status: 'unknown', detail: 'Could not read memory usage' };
  }
}

// --- journald history -----------------------------------------------------------

async function readBoots(): Promise<BootWindow[]> {
  const output = await runQuiet('journalctl', ['--list-boots', '--no-pager', '-o', 'json']);
  try {
    const boots = JSON.parse(output) as { first_entry: number; last_entry: number }[];
    const now = Date.now();
    return boots.map((boot, index) => ({
      start: Math.floor(boot.first_entry / 1000),
      // The running boot extends to now; earlier ones end at their last log line.
      end: index === boots.length - 1 ? now : Math.floor(boot.last_entry / 1000),
    }));
  } catch {
    return [];
  }
}

async function readUnitEvents(units: string[], user: boolean): Promise<UnitEvent[]> {
  const events: UnitEvent[] = [];
  for (const unit of units) {
    const args = user
      ? ['--user', `USER_UNIT=${unit}`, '_COMM=systemd']
      : [`UNIT=${unit}`, '_PID=1'];
    const output = await runQuiet('journalctl', [
      ...args,
      '--since',
      `-${RETAIN_DAYS} days`,
      '-o',
      'json',
      '--output-fields=MESSAGE,JOB_TYPE,JOB_RESULT',
      '--no-pager',
    ]);
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, string>;
        const classified = classifyUnitMessage(entry);
        if (classified) {
          events.push({ at: Math.floor(Number(entry.__REALTIME_TIMESTAMP) / 1000), unit, ...classified });
        }
      } catch {
        // Skip a malformed line rather than losing the unit's whole history.
      }
    }
  }
  return events;
}

/**
 * Rebuilds systemd-backed history from journald. Days journald fully covers
 * are replaced; days older than the journal's retention keep what was stored.
 */
async function refreshJournalHistory(store: UptimeStore): Promise<void> {
  const boots = await readBoots();
  if (boots.length === 0) return;
  const journalStartDay = localDateKey(boots[0].start);
  for (const def of STATIC_COMPONENTS) {
    if (!def.units) continue;
    const events = await readUnitEvents(def.units, def.userUnits === true);
    const fresh: DayMap = {};
    addSegmentsToDays(fresh, unionTimeline(events, boots));
    addEventNotesToDays(fresh, events);
    const kept = Object.fromEntries(
      Object.entries(store.journal[def.id] ?? {}).filter(([day]) => day < journalStartDay),
    );
    for (const [day, stat] of Object.entries(fresh)) {
      if (day >= journalStartDay || !kept[day]) kept[day] = stat;
    }
    store.journal[def.id] = kept;
  }
}

// --- tick ------------------------------------------------------------------------

function pruneOldDays(store: UptimeStore, now: number): void {
  const oldest = recentDateKeys(now, RETAIN_DAYS)[0];
  for (const bucket of [store.samples, store.journal, store.runs]) {
    for (const days of Object.values(bucket)) {
      for (const day of Object.keys(days)) {
        if (day < oldest) delete days[day];
      }
    }
  }
}

async function runCheck(): Promise<UptimeStore> {
  const store = readStore();
  const now = Date.now();
  const checks: Checks = {};
  await probeSystemdComponents(checks);
  await Promise.all([probeHttpComponents(checks), probeGateway(checks)]);
  probeHost(checks);
  await probeCron(store, checks, now);
  await refreshJournalHistory(store);

  const elapsed = store.lastSampleAt ? now - store.lastSampleAt : SAMPLE_INTERVAL_MS;
  const sampledMs = elapsed > MAX_SAMPLE_GAP_MS ? SAMPLE_INTERVAL_MS : elapsed;
  for (const [id, check] of Object.entries(checks)) {
    const days = (store.samples[id] ??= {});
    addSample(days, now, sampledMs, check.status);
    const previous = store.current[id]?.status;
    if (check.status !== previous && check.status !== 'operational' && check.status !== 'unknown') {
      const day = (days[localDateKey(now)] ??= { up: 0, degraded: 0, down: 0 });
      addNote(day, `${formatClock(now)} — ${check.detail}`);
    }
    store.current[id] = { ...check, checkedAt: now };
  }
  store.lastSampleAt = now;
  pruneOldDays(store, now);
  writeJsonFileAtomic(storePath(), store);
  return store;
}

const IN_FLIGHT = Symbol.for('agentic-journal.uptime-check');

/** One check at a time across the interval and page requests. */
export function checkUptime(): Promise<UptimeStore> {
  const globalState = globalThis as { [IN_FLIGHT]?: Promise<UptimeStore> };
  globalState[IN_FLIGHT] ??= runCheck().finally(() => {
    globalState[IN_FLIGHT] = undefined;
  });
  return globalState[IN_FLIGHT]!;
}

/** Returns the view, running a fresh check first when the last one is older than maxAgeMs. */
export async function getUptimeView(maxAgeMs = 60_000): Promise<UptimeView> {
  let store = readStore();
  if (!store.lastSampleAt || Date.now() - store.lastSampleAt > maxAgeMs) {
    store = await checkUptime();
  }
  return buildView(store, Date.now());
}

function historyFor(store: UptimeStore, def: ComponentDef): DayMap {
  const samples = store.samples[def.id] ?? {};
  if (def.history === 'runs') return store.runs[def.id] ?? {};
  if (def.history === 'samples') return samples;
  // Journald wins where it observed the unit; otherwise fall back to samples
  // (e.g. a oneshot unit that never logs, or days before journald retention).
  const journal = store.journal[def.id] ?? {};
  const merged: DayMap = { ...samples };
  for (const [day, stat] of Object.entries(journal)) {
    if (stat.up + stat.down + stat.degraded > 0) {
      merged[day] = { ...stat, notes: [...(stat.notes ?? []), ...(samples[day]?.notes ?? [])].slice(0, 6) };
    }
  }
  return merged;
}

export function buildView(store: UptimeStore, now: number): UptimeView {
  const dateKeys = recentDateKeys(now, WINDOW_DAYS);
  const defs = componentDefs(store);
  const groups: UptimeGroupView[] = GROUPS.map((group) => {
    const components = defs
      .filter((def) => def.group === group.id)
      .map((def) => {
        const days = historyFor(store, def);
        const current = store.current[def.id];
        return {
          id: def.id,
          name: def.name,
          description: def.description,
          status: current?.status ?? 'unknown',
          detail: current?.detail ?? 'Not checked yet',
          uptime: windowUptime(days, dateKeys),
          bars: buildBars(days, dateKeys),
        };
      });
    const withUptime = components.filter((c) => c.uptime !== null);
    return {
      id: group.id,
      name: group.name,
      status: worstStatus(components.map((c) => c.status)),
      uptime: withUptime.length ? withUptime.reduce((sum, c) => sum + (c.uptime as number), 0) / withUptime.length : null,
      bars: combineBars(components.map((c) => c.bars), dateKeys),
      components,
    };
  }).filter((group) => group.components.length > 0);

  return {
    generatedAt: new Date(now).toISOString(),
    checkedAt: store.lastSampleAt ? new Date(store.lastSampleAt).toISOString() : null,
    overall: worstStatus(groups.map((g) => g.status)),
    windowDays: WINDOW_DAYS,
    groups,
  };
}

function formatAgo(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}
