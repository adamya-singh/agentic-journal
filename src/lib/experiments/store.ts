import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { backendDataDir, writeJsonFileAtomic } from '../backend-data.ts';
import { SEED } from './seed.ts';
import { EXPERIMENT_STATUSES, type Direction, type Experiment, type ExperimentStore } from './types.ts';

// Every function here is synchronous on purpose (as the action cards' store): Node runs each to completion, so
// two requests in this process can't interleave a read-modify-write of experiments.json.

export class ExperimentError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const experimentsDir = () => path.join(backendDataDir(), 'experiments');
const storeFile = () => path.join(experimentsDir(), 'experiments.json');

/** The record. A machine with no file yet starts from the seed; the file is written on the first change. */
export function readStore(): ExperimentStore {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as ExperimentStore;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(SEED);
    throw new ExperimentError('The experiment record could not be read. Check experiments/experiments.json.', 500);
  }
}
const writeStore = (store: ExperimentStore) => writeJsonFileAtomic(storeFile(), store);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const line = (max: number) => z.string().trim().max(max);
const list = (max: number, each: number) => z.array(line(each).min(1)).max(max);
const fields = {
  when: day,
  day: line(40),
  direction: line(60).min(1),
  status: z.enum(EXPERIMENT_STATUSES),
  question: line(300).min(1),
  answer: line(600),
  numbers: list(8, 80),
  details: line(4000),
  buildsOn: list(8, 12),
  notes: z.string().max(20000),
  flagged: z.boolean(),
  groups: list(12, 40),
  picture: line(40),
  model: line(20),
};
const patchSchema = z.object(fields).partial().strict();
const createSchema = z.object({ ...fields, question: fields.question.default('New experiment') }).partial().strict();

const shownDay = (when: string) => new Date(`${when}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fail = (error: z.ZodError) => new ExperimentError(error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join(' '));

function check(store: ExperimentStore, e: Experiment) {
  if (!store.directions.some((d) => d.id === e.direction)) throw new ExperimentError(`There is no direction "${e.direction}".`);
  const known = new Set(store.experiments.map((other) => other.id));
  const missing = e.buildsOn.filter((id) => !known.has(id) || id === e.id);
  if (missing.length > 0) throw new ExperimentError(`It can't build on ${missing.join(', ')}: ${missing.length === 1 ? 'that is not another experiment' : 'those are not other experiments'}.`);
}

export function updateExperiment(id: string, input: unknown): Experiment {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) throw fail(parsed.error);
  const store = readStore();
  const index = store.experiments.findIndex((e) => e.id === id);
  if (index < 0) throw new ExperimentError(`There is no experiment ${id}.`, 404);
  const before = store.experiments[index]!;
  const patch = parsed.data;
  const next: Experiment = { ...before, ...patch };
  // A new date shows as that date unless he wrote how it should show.
  if (patch.when !== undefined && patch.when !== before.when && patch.day === undefined) next.day = shownDay(patch.when);
  if (next.day === '') next.day = shownDay(next.when);
  check(store, next);
  store.experiments[index] = next;
  writeStore(store);
  return next;
}

export function addExperiment(input: unknown, today: string): Experiment {
  const parsed = createSchema.safeParse(input ?? {});
  if (!parsed.success) throw fail(parsed.error);
  const store = readStore();
  const number = store.experiments.reduce((most, e) => Math.max(most, Number.parseInt(e.id, 10) || 0), -1) + 1;
  const last = [...store.experiments].sort((a, b) => a.order - b.order).at(-1);
  const when = parsed.data.when ?? today;
  const created: Experiment = {
    id: String(number).padStart(2, '0'), when, day: parsed.data.day || shownDay(when), order: (last?.order ?? -1) + 1,
    direction: parsed.data.direction ?? last?.direction ?? store.directions[0]?.id ?? '', status: parsed.data.status ?? 'running',
    question: parsed.data.question ?? 'New experiment', answer: parsed.data.answer ?? '', numbers: parsed.data.numbers ?? [], details: parsed.data.details ?? '',
    buildsOn: parsed.data.buildsOn ?? [], notes: parsed.data.notes ?? '', flagged: parsed.data.flagged ?? false, groups: parsed.data.groups ?? [],
    picture: parsed.data.picture || 'stack', model: parsed.data.model ?? '',
  };
  check(store, created);
  store.experiments.push(created);
  writeStore(store);
  return created;
}

export function removeExperiment(id: string): void {
  const store = readStore();
  if (!store.experiments.some((e) => e.id === id)) throw new ExperimentError(`There is no experiment ${id}.`, 404);
  store.experiments = store.experiments.filter((e) => e.id !== id).map((e) => ({ ...e, buildsOn: e.buildsOn.filter((other) => other !== id) }));
  writeStore(store);
}

/** Puts a direction on the sky or takes it off; null goes back to "while it has recent work". */
export function setDirectionActive(id: string, active: boolean | null): Direction {
  const store = readStore();
  const direction = store.directions.find((d) => d.id === id);
  if (!direction) throw new ExperimentError(`There is no direction "${id}".`, 404);
  if (active === null) delete direction.active;
  else direction.active = active;
  writeStore(store);
  return direction;
}

export function addDirection(input: unknown): Direction {
  const parsed = z.object({ name: line(40).min(1) }).strict().safeParse(input);
  if (!parsed.success) throw fail(parsed.error);
  const store = readStore();
  const name = parsed.data.name;
  if (store.directions.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw new ExperimentError(`There is already a direction called "${name}".`);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'direction';
  let id = slug;
  for (let n = 2; store.directions.some((d) => d.id === id); n++) id = `${slug}-${n}`;
  const used = new Set(store.directions.map((d) => d.hue % 10));
  let hue = 0;
  while (used.has(hue) && hue < 9) hue++;
  const direction: Direction = { id, name, hue, order: store.directions.reduce((most, d) => Math.max(most, d.order), -1) + 1 };
  store.directions.push(direction);
  writeStore(store);
  return direction;
}
