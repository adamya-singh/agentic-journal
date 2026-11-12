import type { TalkSummary } from './types';

// Who spoke when, from transcripts whose lines carry a second offset:
//   - **[793] Gaurush:** text        or        - [96] **Speaker 1:** text
const LINE = /^- (?:\*\*\[(\d+)\] ([^:*]+):\*\*|\[(\d+)\] \*\*([^:*]+):\*\*)\s*(.*)$/gm;

export function talkSummary(markdown: string, you: string): TalkSummary | undefined {
  const rows: [number, string, number][] = [];
  for (const m of markdown.matchAll(LINE)) {
    rows.push([Number(m[1] ?? m[3]), (m[2] ?? m[4]).trim(), (m[5] ?? '').length]);
  }
  if (rows.length < 4) return undefined;
  const start = rows[0][0];
  const segs: TalkSummary['segs'] = rows.map(([s, who, chars], i) => {
    const end = i + 1 < rows.length ? rows[i + 1][0] : s + Math.max(4, Math.round(chars / 15));
    return [s - start, Math.max(1, end - s), who === you ? 'you' : 'them'];
  });
  const total = segs[segs.length - 1][0] + segs[segs.length - 1][1];
  const yours = segs.filter((s) => s[2] === 'you').reduce((n, s) => n + s[1], 0);
  return { segs, total, youShare: Math.round((yours / total) * 100), turns: segs.length };
}
