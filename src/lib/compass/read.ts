// Filesystem reader for OpenClaw's compass repo (sync fs; server-only). Everything degrades: a missing
// directory, file or git binary produces `available: false` or an empty list, never a throw. Only
// unexpected fs errors (not ENOENT/ENOTDIR/EACCES/EISDIR) propagate to the route's 500.
import fs from 'node:fs';
import path from 'node:path';
import { compassStatus, isIsoDate, todayInNewYork, weeksInclusive } from './dates';
import { frontMatterInt, parseFrontMatter } from './front-matter';
import { fileLastCommitAt, gitAvailable, isCompassRepo, repoInfo } from './git';
import {
  extractBulletBlock,
  extractH2Section,
  parseLogEntries,
  retroVerdict,
  splitH2Sections,
} from './markdown-sections';
import {
  SHORT_TERM_REQUIRED_KEYS,
  SHORT_TERM_SECTIONS,
  type CompassDraft,
  type CompassOverview,
  type LogEntry,
  type LongTermCompass,
  type LongTermFile,
  type LongTermPart,
  type PeriodDetail,
  type PeriodRetro,
  type PeriodState,
  type PeriodSummary,
  type ShortTermCompass,
} from './types';

export const DEFAULT_COMPASS_DIR = '/home/openclaw/.openclaw/workspace/compass';
export const PERIOD_ID_RE = /^\d{4}-\d{2}-\d{2}--\d{4}-\d{2}-\d{2}$/;
const SIZE_WARN_CHARS = 7000;
const SIZE_ERROR_CHARS = 14_000;
const SOFT_ERRNO = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EISDIR', 'EPERM', 'ELOOP']);

/** The compass repo; OPENCLAW_COMPASS_DIR overrides the default for tests and other machines. */
export function compassDir(): string {
  return process.env.OPENCLAW_COMPASS_DIR || DEFAULT_COMPASS_DIR;
}

function isSoftError(e: unknown): boolean {
  return SOFT_ERRNO.has((e as NodeJS.ErrnoException)?.code ?? '');
}

/** File contents, or null when it is missing or unreadable in an expected way. */
export function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (isSoftError(e)) return null;
    throw e;
  }
}

function dirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (e) {
    if (isSoftError(e)) return false;
    throw e;
  }
}

function fileMtime(file: string): string | null {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch (e) {
    if (isSoftError(e)) return null;
    throw e;
  }
}

function emptyShortTerm(file: string): ShortTermCompass {
  return {
    available: false,
    title: '',
    period: null,
    status: null,
    version: null,
    updated: null,
    opened: null,
    closed: null,
    mtime: null,
    text: '',
    frontMatter: {},
    sections: {},
    preamble: '',
    relation: '',
    forAgents: '',
    path: file,
    problems: [],
  };
}

export interface ParseShortTermOptions {
  /** The period id the file name implies (snapshots and drafts); mismatches are reported. */
  expectId?: string;
  mtime?: string | null;
}

/**
 * Parses and validates a compass-shaped markdown file (the live compass, a period snapshot or a
 * draft). Problems are collected, not thrown, so a half-written file still renders.
 */
export function parseShortTermMarkdown(
  raw: string,
  file: string,
  today: string = todayInNewYork(),
  options: ParseShortTermOptions = {},
): ShortTermCompass {
  const fm = parseFrontMatter(raw);
  const data = fm.data;
  const problems = [...fm.problems];
  const split = splitH2Sections(fm.body);

  if (!fm.present) problems.push('No front matter block; the period, dates and version are unknown.');
  else {
    for (const key of SHORT_TERM_REQUIRED_KEYS) {
      if (!data[key]?.trim()) problems.push(`Front matter is missing "${key}".`);
    }
  }
  if (data.kind && data.kind !== 'short-term') {
    problems.push(`kind is "${data.kind}"; a compass is "short-term".`);
  }
  const start = data.start ?? '';
  const end = data.end ?? '';
  const reviewBy = data.review_by?.trim() || null;
  const dateKeys: [string, string | null | undefined][] = [
    ['start', start],
    ['end', end],
    ['review_by', reviewBy],
    ['updated', data.updated],
    ['opened', data.opened],
    ['closed', data.closed],
    ['approved', data.approved],
  ];
  for (const [key, value] of dateKeys) {
    if (value && !isIsoDate(value)) problems.push(`${key} is not a YYYY-MM-DD date (${value}).`);
  }
  const datesOk = isIsoDate(start) && isIsoDate(end);
  if (datesOk && start >= end) problems.push('start must be before end.');
  if (datesOk && reviewBy && isIsoDate(reviewBy) && (reviewBy < start || reviewBy > end)) {
    problems.push('review_by must fall between start and end.');
  }
  if (data.period && datesOk && data.period !== `${start}--${end}`) {
    problems.push(`period "${data.period}" does not match start--end.`);
  }
  if (options.expectId && data.period && data.period !== options.expectId) {
    problems.push(`period "${data.period}" does not match the file's id ${options.expectId}.`);
  }
  const version = frontMatterInt(data.version);
  if (data.version !== undefined && version === null) {
    problems.push(`version must be a whole number of 1 or more (${data.version}).`);
  }

  const expected: readonly string[] = SHORT_TERM_SECTIONS;
  const missing = expected.filter((h) => !split.order.includes(h));
  const extra = split.order.filter((h) => !expected.includes(h));
  if (missing.length) problems.push(`Missing section${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
  if (extra.length) problems.push(`Unexpected section${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`);
  const known = split.order.filter((h) => expected.includes(h));
  if (!missing.length && known.join('|') !== expected.join('|')) problems.push('Sections are out of order.');
  if (split.duplicates.length) {
    problems.push(`Duplicate heading${split.duplicates.length > 1 ? 's' : ''}: ${split.duplicates.join(', ')}.`);
  }
  if (raw.length > SIZE_ERROR_CHARS) {
    problems.push(`The file is ${raw.length.toLocaleString('en-US')} characters; the limit is 14,000.`);
  } else if (raw.length > SIZE_WARN_CHARS) {
    problems.push(`The file is ${raw.length.toLocaleString('en-US')} characters; keep it under 7,000.`);
  }

  const h1 = /^#\s+(.+?)\s*$/m.exec(split.preamble)?.[1]?.trim() ?? '';
  const title = data.title?.trim() || h1;
  const periodId = data.period?.trim() || (datesOk ? `${start}--${end}` : '');
  const period = periodId ? { id: periodId, title, start, end, reviewBy } : null;
  const closed = data.closed?.trim() || null;
  const status = datesOk
    ? compassStatus({ start, end, reviewBy, closed }, today)
    : closed
      ? 'closed'
      : null;

  return {
    available: true,
    title,
    period,
    status,
    version,
    updated: data.updated?.trim() || null,
    opened: data.opened?.trim() || null,
    closed,
    mtime: options.mtime ?? null,
    text: fm.body.trim(),
    frontMatter: data,
    sections: split.sections,
    preamble: split.preamble,
    relation: split.sections['Relation to the long-term compass'] ?? '',
    forAgents: split.sections['For agents'] ?? '',
    path: file,
    problems,
  };
}

/** The live compass at `<dir>/short-term/compass.md`. */
export function readShortTermCompass(
  dir: string = compassDir(),
  today: string = todayInNewYork(),
): ShortTermCompass {
  const file = path.join(dir, 'short-term', 'compass.md');
  const raw = readText(file);
  if (raw === null) return emptyShortTerm(file);
  return parseShortTermMarkdown(raw, file, today, { mtime: fileMtime(file) });
}

interface LongTermSpec {
  key: keyof LongTermCompass['parts'];
  file: LongTermFile;
  label: string;
  heading: string;
  extract: (md: string) => { text: string; endFound: boolean } | null;
}

const LONG_TERM_SPECS: LongTermSpec[] = [
  {
    key: 'user',
    file: 'USER.md',
    label: 'Core North Star (Canonical)',
    heading: '## From USER.md',
    extract: (md) => extractBulletBlock(md, '**Core North Star (Canonical):**', '**Scoreboard:**'),
  },
  {
    key: 'memory',
    file: 'MEMORY.md',
    label: 'North Star Anchor',
    heading: '## From MEMORY.md (North Star Anchor)',
    extract: (md) => {
      const text = extractH2Section(md, 'North Star Anchor');
      return text === null ? null : { text, endFound: true };
    },
  },
  {
    key: 'soul',
    file: 'SOUL.md',
    label: 'Canonical North Star',
    heading: '## From SOUL.md (Canonical North Star)',
    extract: (md) => {
      const text = extractH2Section(md, 'Canonical North Star');
      return text === null ? null : { text, endFound: true };
    },
  },
];

export interface ReadLongTermOptions {
  /** The repo whose history dates the mirrors; null skips git and uses mtimes. */
  gitDir?: string | null;
}

/**
 * The North Star blocks of USER.md, MEMORY.md and SOUL.md found in `folder`. `readLongTermCompass`
 * points this at the repo's mirrors; the Media feed may point it at the live workspace as a fallback.
 */
export function readLongTermFiles(folder: string, options: ReadLongTermOptions = {}): LongTermCompass {
  const problems: string[] = [];
  const files: LongTermFile[] = [];
  const parts: Partial<LongTermCompass['parts']> = {};
  let maxMtime: string | null = null;

  for (const spec of LONG_TERM_SPECS) {
    const file = path.join(folder, spec.file);
    let symlink = false;
    let mtime: string | null = null;
    try {
      const lst = fs.lstatSync(file);
      symlink = lst.isSymbolicLink();
      mtime = (symlink ? fs.statSync(file) : lst).mtime.toISOString();
    } catch (e) {
      if (!isSoftError(e)) throw e;
    }
    const raw = readText(file);
    let text: string | null = null;
    let markerFound = false;
    if (raw !== null) {
      files.push(spec.file);
      if (symlink) problems.push(`${spec.file} is a symlink, not a mirror copy.`);
      if (mtime && (!maxMtime || mtime > maxMtime)) maxMtime = mtime;
      const block = spec.extract(raw);
      if (block && block.text.trim()) {
        text = block.text;
        markerFound = true;
        if (!block.endFound) {
          problems.push(`${spec.file}: the "${spec.label}" block has no closing marker; it was cut at the end of its list.`);
        }
      } else {
        problems.push(`${spec.file}: "${spec.label}" was not found.`);
      }
    }
    parts[spec.key] = {
      file: spec.file,
      label: spec.label,
      text,
      path: file,
      exists: raw !== null,
      symlink,
      markerFound,
      mtime,
    } satisfies LongTermPart;
  }

  const available = files.length > 0;
  const text = LONG_TERM_SPECS.filter((s) => parts[s.key]?.text)
    .map((s) => `${s.heading}\n\n${parts[s.key]!.text}`)
    .join('\n\n');
  let mirroredAt: string | null = null;
  let mirroredAtSource: LongTermCompass['mirroredAtSource'] = null;
  if (available) {
    const gitDir = options.gitDir;
    if (gitDir && gitAvailable() && isCompassRepo(gitDir).isRepo) {
      const at = fileLastCommitAt(gitDir, path.relative(gitDir, folder) || '.');
      if (at) {
        mirroredAt = at;
        mirroredAtSource = 'git';
      }
    }
    if (!mirroredAt && maxMtime) {
      mirroredAt = maxMtime;
      mirroredAtSource = 'mtime';
    }
  }
  return {
    available,
    text,
    parts: parts as LongTermCompass['parts'],
    files,
    mirroredAt,
    mirroredAtSource,
    problems,
  };
}

/** The long-term compass from the mirrors under `<dir>/long-term/`. */
export function readLongTermCompass(dir: string = compassDir()): LongTermCompass {
  return readLongTermFiles(path.join(dir, 'long-term'), { gitDir: dir });
}

function readRetro(file: string): PeriodRetro | null {
  const raw = readText(file);
  if (raw === null) return null;
  const fm = parseFrontMatter(raw);
  const split = splitH2Sections(fm.body);
  return {
    text: fm.body.trim(),
    frontMatter: fm.data,
    sections: split.sections,
    verdict: retroVerdict(fm.data, split.sections),
    closed: fm.data.closed?.trim() || null,
    path: file,
  };
}

interface PeriodFiles {
  dir: string;
  hasDir: boolean;
  snapshot: ShortTermCompass | null;
  logRaw: string | null;
  entries: LogEntry[];
  retro: PeriodRetro | null;
}

function readPeriodFiles(dir: string, id: string, today: string): PeriodFiles {
  const full = path.join(dir, 'short-term', 'periods', id);
  const snapshotFile = path.join(full, 'compass.md');
  const snapshotRaw = readText(snapshotFile);
  const logRaw = readText(path.join(full, 'log.md'));
  return {
    dir: full,
    hasDir: dirExists(full),
    snapshot:
      snapshotRaw === null
        ? null
        : parseShortTermMarkdown(snapshotRaw, snapshotFile, today, {
            expectId: id,
            mtime: fileMtime(snapshotFile),
          }),
    logRaw,
    entries: logRaw === null ? [] : parseLogEntries(logRaw),
    retro: readRetro(path.join(full, 'retro.md')),
  };
}

function summarisePeriod(
  id: string,
  files: PeriodFiles,
  current: ShortTermCompass,
): PeriodSummary {
  const [start, end] = id.split('--');
  const isLive = current.available && current.period?.id === id;
  const live = isLive ? current : null;
  const closed = files.snapshot?.closed ?? live?.closed ?? files.retro?.closed ?? null;
  const isCurrent = isLive && !current.closed;
  const state: PeriodState = isCurrent ? 'current' : closed ? 'closed' : 'unfinished';
  return {
    id,
    title: files.snapshot?.title || live?.title || id,
    start,
    end,
    weeks: weeksInclusive(start, end),
    state,
    current: isCurrent,
    opened: files.snapshot?.opened ?? live?.opened ?? null,
    closed,
    finalVersion: files.snapshot?.version ?? live?.version ?? null,
    verdict: files.retro?.verdict ?? null,
    hasSnapshot: files.snapshot !== null,
    hasLog: files.logRaw !== null,
    hasRetro: files.retro !== null,
    logEntries: files.entries.length,
    lastLogDate: files.entries.find((e) => e.date)?.date ?? null,
    path: path.posix.join('short-term', 'periods', id),
    hasDir: files.hasDir,
  };
}

/**
 * Every recorded period plus the live one (synthesised when its directory does not exist yet),
 * newest start first.
 */
export function listPeriods(
  dir: string = compassDir(),
  today: string = todayInNewYork(),
  current: ShortTermCompass = readShortTermCompass(dir, today),
): PeriodSummary[] {
  const base = path.join(dir, 'short-term', 'periods');
  const ids = dirExists(base)
    ? fs
        .readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && PERIOD_ID_RE.test(d.name))
        .map((d) => d.name)
    : [];
  const currentId = current.period?.id;
  if (currentId && PERIOD_ID_RE.test(currentId) && !ids.includes(currentId)) ids.push(currentId);
  return ids
    .map((id) => summarisePeriod(id, readPeriodFiles(dir, id, today), current))
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

/** Pending next-period proposals under `short-term/drafts/`, soonest start first. */
export function readDrafts(dir: string = compassDir(), today: string = todayInNewYork()): CompassDraft[] {
  const base = path.join(dir, 'short-term', 'drafts');
  if (!dirExists(base)) return [];
  const drafts: CompassDraft[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const id = entry.name.slice(0, -3);
    if (!PERIOD_ID_RE.test(id)) continue;
    const file = path.join(base, entry.name);
    const raw = readText(file);
    if (raw === null) continue;
    const c = parseShortTermMarkdown(raw, file, today, { expectId: id, mtime: fileMtime(file) });
    drafts.push({
      id,
      title: c.title || id,
      start: c.period?.start || id.slice(0, 10),
      end: c.period?.end || id.slice(12),
      reviewBy: c.period?.reviewBy ?? null,
      version: c.version,
      updated: c.updated,
      approved: c.frontMatter.approved?.trim() || null,
      approvedBy: c.frontMatter.approved_by?.trim() || null,
      text: c.text,
      sections: c.sections,
      path: file,
      problems: c.problems,
    });
  }
  return drafts.sort((a, b) => a.id.localeCompare(b.id));
}

/** The draft that opens next, or null. */
export function readDraft(dir: string = compassDir(), today: string = todayInNewYork()): CompassDraft | null {
  return readDrafts(dir, today)[0] ?? null;
}

/** One period's snapshot (or the live compass while it is open), log and retro; null if unknown. */
export function readPeriod(
  id: string,
  dir: string = compassDir(),
  today: string = todayInNewYork(),
): PeriodDetail | null {
  if (!PERIOD_ID_RE.test(id)) return null;
  const base = path.resolve(dir, 'short-term', 'periods');
  const full = path.resolve(base, id);
  if (!full.startsWith(base + path.sep)) return null;
  const current = readShortTermCompass(dir, today);
  const files = readPeriodFiles(dir, id, today);
  const isLive = current.available && current.period?.id === id;
  if (!files.hasDir && !isLive) return null;
  const compass: PeriodDetail['compass'] = files.snapshot
    ? { ...files.snapshot, source: 'snapshot' }
    : isLive
      ? { ...current, source: 'current' }
      : null;
  return {
    summary: summarisePeriod(id, files, current),
    compass,
    log:
      files.logRaw === null
        ? null
        : { text: files.logRaw, entries: files.entries, path: path.join(files.dir, 'log.md') },
    retro: files.retro,
  };
}

/** Everything the /compass page needs in one read. */
export function readOverview(dir: string = compassDir(), today: string = todayInNewYork()): CompassOverview {
  const shortTerm = readShortTermCompass(dir, today);
  return {
    today,
    dir,
    available: dirExists(dir),
    shortTerm,
    longTerm: readLongTermCompass(dir),
    periods: listPeriods(dir, today, shortTerm),
    drafts: readDrafts(dir, today),
    repo: repoInfo(dir),
    generatedAt: new Date().toISOString(),
  };
}
