import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CompassKind } from './feed-types.ts';

// Read-only view of OpenClaw's compasses, for the feed. The long-term compass is
// its North Star (USER.md "Core North Star", MEMORY.md "North Star Anchor",
// SOUL.md "Canonical North Star"); the short-term compass is
// $OPENCLAW_COMPASS_DIR/short-term/compass.md (flat front matter: title, period,
// start, end, review_by, updated; H2 "Relation to the long-term compass"), kept in
// its own git repo by the compass skill. The Journal never writes either.
// When src/lib/compass (the /compass page's reader) lands, this file should
// delegate to readShortTermCompass / readLongTermCompass instead of parsing.

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

function read(file: string): { text: string; mtime: string } | undefined {
  try {
    return {
      text: fs.readFileSync(file, 'utf8'),
      mtime: fs.statSync(file).mtime.toISOString(),
    };
  } catch {
    return undefined;
  }
}

// Minimal YAML front matter: `key: value` lines, quotes stripped. Nested values are ignored.
export function frontMatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv && kv[2].trim()) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: md.slice(m[0].length) };
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
export function parseShortTerm(md: string): Omit<Compass, 'kind' | 'source' | 'available'> {
  const { meta, body } = frontMatter(md);
  const start = meta.start;
  const end = meta.end;
  // `period` is the id "<start>--<end>"; a free-text duration is a fallback label.
  const label = meta.period && !/^\d{4}-\d{2}-\d{2}--/.test(meta.period) ? meta.period : meta.duration;
  const title = meta.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    // "## For agents" is OpenClaw's rulebook, not something to show you.
    text: body.replace(/^## For agents[\s\S]*?(?=^## |(?![\s\S]))/m, '').trim(),
    forAgents: section(body, /^## For agents/i),
    periodId: meta.period || (start && end ? `${start}--${end}` : undefined),
    version: meta.version ? Number(meta.version) || undefined : undefined,
    title,
    updatedAt: meta.updated || meta.updated_at,
    period:
      start || end || label
        ? {
            start: start?.match(DATE)?.[0],
            end: end?.match(DATE)?.[0],
            label: label || undefined,
          }
        : undefined,
    relation: section(body, /relat|long[- ]term|serves|north star/i),
  };
}

// USER.md's "Core North Star" bullet block, through the Scoreboard bullet.
function northStarBlock(md: string) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /North Star/i.test(l));
  if (start < 0) return undefined;
  const out: string[] = [];
  for (const line of lines.slice(start)) {
    if (/^---/.test(line) || (out.length && /^#{1,6}\s/.test(line))) break;
    out.push(line);
    // The block ends at the Scoreboard bullet; what follows (e.g. consent preferences) isn't the compass.
    if (/\*\*Scoreboard:\*\*/.test(line)) break;
  }
  return out.join('\n').trim();
}

export function readCompass(kind: CompassKind): Compass {
  if (kind === 'short') {
    const file = shortTermPath();
    const got = read(file);
    if (!got || !got.text.trim()) return { kind, available: false, text: '', source: file };
    return { kind, available: true, source: file, updatedAt: got.mtime, ...parseShortTerm(got.text) };
  }
  const userFile = path.join(workspace(), 'USER.md'),
    memoryFile = path.join(workspace(), 'MEMORY.md'),
    soulFile = path.join(workspace(), 'SOUL.md');
  const user = read(userFile),
    memory = read(memoryFile),
    soul = read(soulFile);
  const parts = [
    user && northStarBlock(user.text),
    memory && section(memory.text, /North Star Anchor/i),
    soul && section(soul.text, /Canonical North Star/i),
  ].filter((x): x is string => !!x);
  return {
    kind,
    available: parts.length > 0,
    text: parts.join('\n\n'),
    source: [userFile, memoryFile, soulFile].filter((_, i) => [user, memory, soul][i]).join(' + '),
    updatedAt: [user?.mtime, memory?.mtime, soul?.mtime].filter(Boolean).sort().at(-1),
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
