// The write-up of each experiment, beside the record: experiments/writeups.json under the backend data dir, by
// experiment id. Whoever analysed the run writes it (Claude Code after the analysis, or OpenClaw), in the order
// the experiment-analyze-explain skill explains a result. An experiment with none shows what the record knows.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeJsonFileAtomic } from '../backend-data.ts';
import { ExperimentError, experimentsDir, readStore } from './store.ts';
import { SEED_WRITEUPS } from './seed-writeups.ts';
import { POST_TONES, PREDICTION_RESULTS, PREDICTION_WORDS, STAGE_STATES, type Writeup } from './types.ts';

const file = () => path.join(experimentsDir(), 'writeups.json');
type Kept = { version: 1; writeups: Record<string, Writeup | null> };   // null: he removed a seeded one
function readKept(): Kept {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as Kept;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, writeups: {} };
    throw new ExperimentError('The write-ups could not be read. Check experiments/writeups.json.', 500);
  }
}

/** The write-up of one experiment, or null when nobody has written one. */
export function readWriteup(id: string): Writeup | null {
  const kept = readKept().writeups;
  return id in kept ? kept[id] ?? null : SEED_WRITEUPS[id] ?? null;
}

const text = (max: number) => z.string().trim().max(max).default('');
const named = (max: number) => z.string().trim().min(1).max(max);
const checks = z.array(z.object({ text: named(400), ok: z.boolean() }).strict()).max(16).default([]);
// The post a write-up reads as. Numbers in a figure are the ones in the run's files: whoever writes it reads them with code.
const tone = z.enum(POST_TONES).default('accent');
const num = z.number().finite();
const marks = z.array(z.object({ y: num, label: text(60) }).strict()).max(4).default([]);
const figure = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bars'), of: num.positive(),
    rows: z.array(z.object({ label: named(60), value: num.nonnegative(), note: text(40), tone, strong: z.boolean().default(false) }).strict()).min(1).max(12) }).strict(),
  z.object({ type: z.literal('lines'), x: text(60), log: z.boolean().default(false),
    series: z.array(z.object({ name: named(60), tone, dashed: z.boolean().default(false), thin: z.boolean().default(false),
      points: z.array(z.tuple([num, num])).min(2).max(400), end: text(40) }).strict()).min(1).max(6),
    marks, callouts: z.array(z.object({ x: num, y: num, label: named(60), tone }).strict()).max(3).default([]) }).strict(),
  z.object({ type: z.literal('outcomes'), column: text(40),
    legend: z.array(z.object({ code: z.string().length(1), label: named(40), tone }).strict()).min(1).max(6),
    rows: z.array(z.object({ label: named(60), cells: z.array(z.string().max(6)).min(1).max(16), total: text(20), gap: z.boolean().default(false) }).strict()).min(1).max(10) }).strict(),
  z.object({ type: z.literal('columns'), x: text(60), log: z.boolean().default(false),
    bars: z.array(z.object({ label: named(20), value: num, tone, top: text(12) }).strict()).min(1).max(24), marks }).strict(),
]);
const block = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: named(1200) }).strict(),
  z.object({ kind: z.literal('listing'), text: z.string().min(1).max(2400) }).strict(),
  z.object({ kind: z.literal('table'), head: z.array(z.string().trim().max(80)).min(1).max(8), rows: z.array(z.array(z.string().trim().max(120)).min(1).max(8)).max(24) }).strict(),
  z.object({ kind: z.literal('figure'), figure, caption: text(500) }).strict(),
  z.object({ kind: z.literal('command'), text: named(600) }).strict(),
  z.object({ kind: z.literal('files'), files: z.array(z.object({ path: named(300), note: text(160) }).strict()).min(1).max(24) }).strict(),
  z.object({ kind: z.literal('predictions'), items: z.array(z.object({ text: named(300), result: z.enum(PREDICTION_RESULTS) }).strict()).min(1).max(8) }).strict(),
  z.object({ kind: z.literal('checks'), items: z.array(z.object({ text: named(400), ok: z.boolean() }).strict()).min(1).max(16) }).strict(),
  z.object({ kind: z.literal('next'), items: z.array(z.object({ title: named(200), why: text(400) }).strict()).min(1).max(6) }).strict(),
]);
const post = z.object({
  title: text(200), tldr: text(500),
  sections: z.array(z.object({ name: named(60), gist: named(320), story: z.array(block).max(8).default([]), detail: z.array(block).max(8).default([]) }).strict()).min(1).max(12),
}).strict();
/** What is wrong inside a post that its shape alone does not say, or ''. */
function postProblem(p: z.infer<typeof post>): string {
  for (const section of p.sections) for (const b of [...section.story, ...section.detail]) {
    const at = `In "${section.name}",`;
    if (b.kind === 'table') {
      const wide = b.rows.find((row) => row.length !== b.head.length);
      if (wide) return `${at} the row "${wide[0]}" has ${wide.length} cells and the table has ${b.head.length} columns.`;
    }
    if (b.kind !== 'figure') continue;
    const f = b.figure;
    if (f.type === 'bars' && f.rows.some((row) => row.value > f.of)) return `${at} a bar is longer than the ${f.of} it is out of.`;
    if (f.type === 'outcomes') {
      const codes = new Set(f.legend.map((one) => one.code));
      if (f.rows.some((row) => row.cells.length !== f.rows[0]!.cells.length)) return `${at} the rows of the outcome grid have different numbers of cells.`;
      const odd = f.rows.flatMap((row) => row.cells.join('').split('')).find((code) => !codes.has(code));
      if (odd) return `${at} the outcome "${odd}" is not in the legend.`;
    }
    if ((f.type === 'lines' || f.type === 'columns') && f.log) {
      const values = f.type === 'lines' ? [...f.series.flatMap((s) => s.points.map((point) => point[1])), ...f.callouts.map((c) => c.y)] : f.bars.map((bar) => bar.value);
      if ([...values, ...f.marks.map((mark) => mark.y)].some((v) => v <= 0)) return `${at} a log-scale chart has a value at or below zero.`;
    }
  }
  return '';
}

const schema = z.object({
  question: text(600), measure: text(600), outcome: text(600), setup: text(2500),
  parts: z.array(z.object({
    title: named(200), why: text(800), did: text(800),
    predictions: z.array(z.object({ text: named(300), result: z.enum(PREDICTION_RESULTS) }).strict()).max(8).default([]),
    table: z.object({
      head: z.array(z.string().trim().max(80)).min(1).max(8),
      rows: z.array(z.object({ cells: z.array(z.string().trim().max(80)).min(1).max(8), mark: z.enum(['', 'baseline', 'ours']).default('') }).strict()).max(24),
    }).strict().nullable().default(null),
    conclusion: text(800),
  }).strict()).max(8).default([]),
  trust: checks,
  meaning: text(1500), lesson: text(600),
  next: z.array(z.object({ title: named(200), why: text(400) }).strict()).max(6).default([]),
  log: text(6000),
  run: z.object({
    state: text(120), line: text(300),
    watch: z.array(z.object({ title: named(80), note: text(160), href: text(500).refine((v) => v === '' || /^https?:\/\//.test(v), 'Use an http(s) address, or leave it empty.') }).strict()).max(8).default([]),
    command: text(600),
    stages: z.array(z.object({ name: named(80), note: text(300), state: z.enum(STAGE_STATES) }).strict()).max(24).default([]),
    housekeeping: checks,
    files: z.array(z.object({ path: named(300), note: text(160) }).strict()).max(24).default([]),
  }).strict().default({}),
  post: post.nullable().default(null),
}).strict();

/** Writes (or with null, removes) the write-up of an experiment. The whole write-up is given each time. */
export function writeWriteup(id: string, input: unknown, now = new Date()): Writeup | null {
  if (!readStore().experiments.some((e) => e.id === id)) throw new ExperimentError(`There is no experiment ${id}.`, 404);
  const kept = readKept();
  if (input === null) {
    kept.writeups[id] = null;
    writeJsonFileAtomic(file(), kept);
    return null;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ExperimentError(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'writeup'}: ${issue.message}`).join(' '));
  for (const part of parsed.data.parts) {
    const wide = part.table?.rows.find((row) => row.cells.length !== part.table!.head.length);
    if (wide) throw new ExperimentError(`In "${part.title}", the row "${wide.cells[0]}" has ${wide.cells.length} cells and the table has ${part.table!.head.length} columns.`);
  }
  const wrong = parsed.data.post ? postProblem(parsed.data.post) : '';
  if (wrong) throw new ExperimentError(wrong);
  const writeup: Writeup = { ...parsed.data, updated: now.toISOString() };
  kept.writeups[id] = writeup;
  writeJsonFileAtomic(file(), kept);
  return writeup;
}

/**
 * The write-up in a few lines, for what OpenClaw is told when a chat on the experiment starts (the chat's first
 * turn carries about 1,500 characters of notes): the outcome, each part's conclusion, and where the rest is.
 */
export function writeupSummary(id: string, w: Writeup): string {
  const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
  const lines = ['## Write-up'];
  if (w.outcome) lines.push(`Outcome: ${clip(w.outcome, 220)}`);
  w.parts.forEach((part, index) => {
    const marks = part.predictions.map((p) => PREDICTION_WORDS[p.result].toLowerCase()).join(', ');
    lines.push(`${index + 1}. ${clip(part.title, 80)}${marks ? ` (predictions: ${marks})` : ''} ${clip(part.conclusion, 170)}`.trim());
  });
  if (w.meaning) lines.push(`Means: ${clip(w.meaning, 200)}`);
  if (w.post?.tldr) lines.push(`In short: ${clip(w.post.tldr, 220)}`);
  if (w.run.state) lines.push(`Run: ${clip([w.run.state, w.run.line].filter(Boolean).join(' · '), 120)}`);
  lines.push(`The whole write-up (tables, checks, files): GET /api/experiments/writeup?id=${id}`);
  return lines.join('\n');
}
