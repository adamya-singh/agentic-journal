import os from 'node:os';
import path from 'node:path';
import type { CompassKind } from './feed-types.ts';
import { parseFrontMatter } from '../compass/front-matter.ts';
import {
  parseShortTermMarkdown,
  readLongTermCompass,
  readLongTermFiles,
  readShortTermCompass,
} from '../compass/read.ts';
import type { ShortTermCompass } from '../compass/types.ts';

// The feed's view of OpenClaw's compasses, in the shape the judge, the digest and /media/feed were
// built against. Parsing lives in src/lib/compass (the /compass page's reader); this file only adapts
// its results. The long-term compass comes from the mirrors under $OPENCLAW_COMPASS_DIR/long-term/
// and, until the mirror timer has run, from the live workspace USER.md / MEMORY.md / SOUL.md.
// The Journal never writes either compass.

export interface Compass {
  kind: CompassKind;
  available: boolean;
  text: string;
  source: string; // path(s) it was read from
  updatedAt?: string;
  title?: string;
  period?: { start?: string; end?: string; label?: string };
  relation?: string; // how the short-term compass serves the long-term one
  forAgents?: string; // OpenClaw-only rules (feed judging hints), sent to the judge
  periodId?: string; // "<start>--<end>"; a new id means a new period
  version?: number; // bumps on every edit, resets to 1 when a period opens
}

const workspace = () =>
  process.env.OPENCLAW_WORKSPACE_DIR || path.join(os.homedir(), '.openclaw', 'workspace');
const expand = (p: string) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
export const compassDir = () =>
  expand(process.env.OPENCLAW_COMPASS_DIR || path.join(workspace(), 'compass'));
export const shortTermPath = () => path.join(compassDir(), 'short-term', 'compass.md');

// Flat front matter (`key: value`, quotes stripped), via the shared parser.
export function frontMatter(md: string): { meta: Record<string, string>; body: string } {
  const fm = parseFrontMatter(md);
  return { meta: fm.data, body: fm.body };
}

// The text under the first heading matching `title`, up to the next heading of the same or higher level.
export function section(md: string, title: RegExp): string | undefined {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && title.test(l));
  if (start < 0) return undefined;
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex(
    (l, i) => i > start && /^#{1,6}\s/.test(l) && l.match(/^#+/)![0].length <= level,
  );
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

const DATE = /\d{4}-\d{2}-\d{2}/;
const PERIOD_ID = /^\d{4}-\d{2}-\d{2}--/;
// "## For agents" is OpenClaw's rulebook, not something to show you.
const FOR_AGENTS = /^## For agents[\s\S]*?(?=^## |(?![\s\S]))/m;

function toCompass(c: ShortTermCompass): Omit<Compass, 'kind' | 'source' | 'available'> {
  const meta = c.frontMatter;
  const start = meta.start?.match(DATE)?.[0];
  const end = meta.end?.match(DATE)?.[0];
  // `period` is the id "<start>--<end>"; a free-text duration is a fallback label.
  const label = meta.period && !PERIOD_ID.test(meta.period) ? meta.period : meta.duration;
  return {
    text: c.text.replace(FOR_AGENTS, '').trim(),
    forAgents: c.forAgents || undefined,
    periodId: c.period?.id || undefined,
    version: c.version ?? undefined,
    title: c.title || undefined,
    updatedAt: c.updated ?? meta.updated_at ?? c.mtime ?? undefined,
    period:
      start || end || label ? { start, end, label: label || undefined } : undefined,
    relation: c.relation || undefined,
  };
}

export function parseShortTerm(md: string): Omit<Compass, 'kind' | 'source' | 'available'> {
  return toCompass(parseShortTermMarkdown(md, ''));
}

export function readCompass(kind: CompassKind): Compass {
  if (kind === 'short') {
    const c = readShortTermCompass(compassDir());
    const empty = !c.text.trim() && Object.keys(c.frontMatter).length === 0;
    if (!c.available || empty) return { kind, available: false, text: '', source: c.path };
    return { kind, available: true, source: c.path, ...toCompass(c) };
  }
  const mirrors = readLongTermCompass(compassDir());
  const lt = mirrors.available ? mirrors : readLongTermFiles(workspace(), { gitDir: null });
  const sources = [lt.parts.user, lt.parts.memory, lt.parts.soul]
    .filter((part) => part.exists)
    .map((part) => part.path);
  return {
    kind,
    available: lt.text.trim().length > 0,
    text: lt.text,
    source: sources.join(' + ') || path.join(compassDir(), 'long-term'),
    updatedAt: lt.mirroredAt ?? undefined,
  };
}

// The first couple of sentences, for the page.
export function excerpt(text: string, max = 280) {
  const plain = text
    .replace(/^---[\s\S]*?---/, '')
    .replace(/^#+\s.*$/gm, '')
    // "**Core North Star (Canonical):** "…"" reads better as just the quote.
    .replace(/\*\*[^*]{1,60}:\*\*\s*/g, '')
    .replace(/[*_`>]/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^"([^"]+)"/, '$1');
  return plain.length > max ? `${plain.slice(0, max).replace(/\s\S*$/, '')}…` : plain;
}
