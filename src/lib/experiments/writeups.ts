// The write-up of each experiment, beside the record: experiments/writeups.json under the backend data dir, by
// experiment id. Whoever analysed the run writes it (Claude Code after the analysis, or OpenClaw), in the order
// the experiment-analyze-explain skill explains a result. An experiment with none shows what the record knows.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeJsonFileAtomic } from '../backend-data.ts';
import { ExperimentError, experimentsDir, readStore } from './store.ts';
import { SEED_WRITEUPS } from './seed-writeups.ts';
import { PREDICTION_RESULTS, PREDICTION_WORDS, STAGE_STATES, type Writeup } from './types.ts';

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
  if (w.run.state) lines.push(`Run: ${clip([w.run.state, w.run.line].filter(Boolean).join(' · '), 120)}`);
  lines.push(`The whole write-up (tables, checks, files): GET /api/experiments/writeup?id=${id}`);
  return lines.join('\n');
}
