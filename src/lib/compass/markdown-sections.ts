// Markdown structure helpers for compass files. Pure and client-safe: the page uses them to split
// Focus items into cards, the reader uses them to find sections and log entries.
import type { LogEntry, LogEntryKind, RetroVerdict } from './types';

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const H2_RE = /^##\s+(.*?)\s*#*\s*$/;
const H1_OR_H2_RE = /^#{1,2}\s/;

/** Walks lines, reporting whether each one sits inside a ``` or ~~~ fence. */
function* fencedLines(md: string): Generator<{ line: string; index: number; inFence: boolean }> {
  const lines = md.split(/\r?\n/);
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = FENCE_RE.exec(line);
    if (m) {
      const marker = m[1];
      if (!fence) {
        fence = marker;
        yield { line, index: i, inFence: true };
        continue;
      }
      if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
        yield { line, index: i, inFence: true };
        continue;
      }
    }
    yield { line, index: i, inFence: fence !== null };
  }
}

export interface H2Split {
  /** Heading text → section body (trimmed); duplicate headings are merged in order. */
  sections: Record<string, string>;
  /** Headings in the order they first appear. */
  order: string[];
  /** Text before the first H2. */
  preamble: string;
  /** Headings that appear more than once. */
  duplicates: string[];
}

/** Splits a body on its H2 headings (exact heading text as keys). H3s stay inside their section. */
export function splitH2Sections(body: string): H2Split {
  const sections: Record<string, string[]> = {};
  const order: string[] = [];
  const duplicates: string[] = [];
  const preamble: string[] = [];
  let current: string | null = null;
  for (const { line, inFence } of fencedLines(body)) {
    const m = inFence ? null : H2_RE.exec(line);
    if (m) {
      const key = m[1].trim();
      if (!(key in sections)) {
        sections[key] = [];
        order.push(key);
      } else if (!duplicates.includes(key)) duplicates.push(key);
      current = key;
      if (sections[key].length) {
        while (sections[key].length && sections[key][sections[key].length - 1].trim() === '') sections[key].pop();
        sections[key].push('');
      }
      continue;
    }
    if (current === null) preamble.push(line);
    else sections[current].push(line);
  }
  return {
    sections: Object.fromEntries(order.map((k) => [k, sections[k].join('\n').trim()])),
    order,
    preamble: preamble.join('\n').trim(),
    duplicates,
  };
}

export interface TopLevelItem {
  /** "1." / "2." / "-" as written. */
  marker: string;
  /** The item text with the marker stripped and continuation lines de-indented. */
  text: string;
}

export interface TopLevelItems {
  /** Text before the first list item. */
  lead: string;
  items: TopLevelItem[];
  /** Text after the list (rare; kept so nothing is hidden). */
  trailing: string;
}

const ITEM_RE = /^(\d{1,3}[.)]|[-*+])\s+(.*)$/;

/** Splits a section into its top-level list items; nested lines stay with their item. */
export function splitTopLevelItems(md: string): TopLevelItems {
  const lead: string[] = [];
  const trailing: string[] = [];
  const items: { marker: string; lines: string[] }[] = [];
  let state: 'lead' | 'items' | 'trailing' = 'lead';
  for (const { line, inFence } of fencedLines(md)) {
    const m = inFence ? null : ITEM_RE.exec(line);
    if (m) {
      items.push({ marker: m[1], lines: [m[2]] });
      state = 'items';
      continue;
    }
    if (state === 'lead') {
      lead.push(line);
      continue;
    }
    const last = items[items.length - 1];
    // A blank line followed by unindented prose ends the list.
    if (state === 'items' && line.trim() === '') {
      last.lines.push('');
      continue;
    }
    if (state === 'items' && !/^\s/.test(line) && last.lines[last.lines.length - 1] === '') {
      state = 'trailing';
    }
    if (state === 'trailing') {
      trailing.push(line);
      continue;
    }
    last.lines.push(line.replace(/^ {1,4}|^\t/, ''));
  }
  return {
    lead: lead.join('\n').trim(),
    items: items.map((it) => ({ marker: it.marker, text: it.lines.join('\n').trim() })),
    trailing: trailing.join('\n').trim(),
  };
}

const LOG_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\b\s*(.*?)\s*$/;
const SOURCE_RE = /^(?:[—–-]\s*(pulse|chat|system)\b|\((pulse|chat|system)\))\s*/i;
const SEPARATOR_RE = /^[—–:-]\s*/;

/**
 * Entries of a period log: `## YYYY-MM-DD — pulse|chat|system[ — title]`, also accepting `-`, `–`
 * and `(source)`. Newest first; same-day entries keep the later one first.
 */
export function parseLogEntries(md: string): LogEntry[] {
  const entries: (LogEntry & { order: number })[] = [];
  let current: (LogEntry & { order: number; lines: string[] }) | null = null;
  const flush = () => {
    if (!current) return;
    const { lines, ...rest } = current;
    entries.push({ ...rest, body: lines.join('\n').trim() });
    current = null;
  };
  for (const { line, inFence } of fencedLines(md)) {
    if (!inFence && /^##\s/.test(line)) {
      // Every H2 outside a fence starts an entry; one without a date is kept as "other" so nothing hides.
      flush();
      const m = LOG_HEADING_RE.exec(line);
      let rest = m ? m[2] : line.replace(/^##\s+/, '');
      let kind: LogEntryKind = 'other';
      const s = m ? SOURCE_RE.exec(rest) : null;
      if (s) {
        kind = (s[1] || s[2]).toLowerCase() as LogEntryKind;
        rest = rest.slice(s[0].length);
      }
      const title = (m ? rest.replace(SEPARATOR_RE, '') : rest).trim();
      current = {
        date: m ? m[1] : '',
        kind,
        title: title || null,
        heading: line.trim(),
        body: '',
        order: entries.length,
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return entries
    .sort((a, b) => (a.date === b.date ? b.order - a.order : a.date < b.date ? 1 : -1))
    .map((e) => ({ date: e.date, kind: e.kind, title: e.title, heading: e.heading, body: e.body }));
}

const VERDICTS: RetroVerdict[] = ['too short', 'too long', 'right', 'unknown'];

function normaliseVerdict(value: string | undefined | null): RetroVerdict | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/^["']|["']$/g, '');
  return (VERDICTS as string[]).includes(v) ? (v as RetroVerdict) : null;
}

/** The retro's verdict: front matter `verdict` first, then the "Period-length verdict" section. */
export function retroVerdict(
  frontMatter: Record<string, string>,
  sections: Record<string, string>,
): RetroVerdict | null {
  const fromMeta = normaliseVerdict(frontMatter.verdict);
  if (fromMeta) return fromMeta;
  const section =
    sections['Period-length verdict'] ??
    Object.entries(sections).find(([k]) => /period.length verdict/i.test(k))?.[1];
  if (!section) return null;
  const bold = /\*\*(too short|too long|right|unknown)\*\*/i.exec(section);
  if (bold) return normaliseVerdict(bold[1]);
  const plain = /\b(too short|too long|unknown)\b/i.exec(section) ?? /\b(right)\b/i.exec(section);
  return plain ? normaliseVerdict(plain[1]) : null;
}

export interface BulletBlock {
  text: string;
  /** False when the end marker was missing and the block ran to the end of its list. */
  endFound: boolean;
}

/**
 * The bullet containing `startMarker` through the bullet containing `endMarker`, with each
 * bullet's indented continuation lines. Used for USER.md's Core North Star block.
 */
export function extractBulletBlock(
  md: string,
  startMarker: string,
  endMarker: string,
): BulletBlock | null {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes(startMarker));
  if (start < 0) return null;
  const out: string[] = [];
  let endFound = false;
  let endSeen = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const isBullet = /^\s*[-*+]\s+/.test(line);
    const isContinuation = /^\s+\S/.test(line) && !isBullet;
    if (i > start && endSeen && !isContinuation) break;
    if (i > start && !endSeen && line.trim() === '') break;
    if (i > start && !endSeen && !isBullet && !isContinuation) break;
    out.push(line);
    if (line.includes(endMarker)) {
      endFound = true;
      endSeen = true;
    }
  }
  return { text: out.join('\n').replace(/\s+$/, ''), endFound };
}

/** The body under `## <heading>` (case-insensitive) up to the next H1 or H2, or null. */
export function extractH2Section(md: string, heading: string): string | null {
  const want = heading.trim().toLowerCase();
  let collecting = false;
  const out: string[] = [];
  for (const { line, inFence } of fencedLines(md)) {
    if (!inFence) {
      const m = H2_RE.exec(line);
      if (m && m[1].trim().toLowerCase() === want) {
        if (collecting) break;
        collecting = true;
        continue;
      }
      if (collecting && H1_OR_H2_RE.test(line)) break;
    }
    if (collecting) out.push(line);
  }
  return collecting ? out.join('\n').trim() : null;
}

/** "compass(short): tighten bet 2" → { kind: 'short', subject: 'tighten bet 2' }. */
export function splitCommitSubject(subject: string): { kind: string | null; subject: string } {
  const m = /^compass\(([a-z-]+)\):\s*(.*)$/i.exec(subject.trim());
  return m ? { kind: m[1].toLowerCase(), subject: m[2].trim() } : { kind: null, subject: subject.trim() };
}
