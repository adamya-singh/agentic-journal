// The experiment record as Sunrise reads it. Pure: the route, the page and the tests share it.
//
// The sun is today. On the sky are the experiments in play, one slice per active direction: running ones nearest
// the sun, then the ones flagged for follow-up, then each direction's latest result, then other results from the
// last two weeks. Everything else is history, under the horizon. The engine's ring program holds 16 things, so
// the sky holds at most that many; the rest of what is recent stays in the history.
import type { HorizonItem, HorizonZone } from '../horizon.ts';
import type { FormSpec } from '../sunrise/form-spec.ts';
import type { SunriseData } from '../sunrise/data.ts';
import { STATUS_WORDS, type Direction, type Experiment, type ExperimentStore, type ExperimentsView } from './types.ts';

// On the sky and in the workspace an experiment goes by "exp-<number>" (lib/experiments/brief.ts reads the same id).
const taskId = (id: string) => `exp-${id}`;

const SKY_MAX = 16;
const RECENT_DAYS = 14;
const ACTIVE_DAYS = 21;
const ZONES: Exclude<HorizonZone, 'hold'>[] = ['ignition', 'climb', 'altitude', 'orbit'];
// The far side's bounds (engine.ts's farBounds): fixed, so a ring is a place and not a stretch of the calendar.
const BOUNDS = { climb: 156, altitude: 324 };
const ringHours = (ring: number, through: number) =>
  ring === 0 ? through * 48 : ring === 1 ? 48 + through * (BOUNDS.climb - 48) : ring === 2 ? BOUNDS.climb + through * (BOUNDS.altitude - BOUNDS.climb) : BOUNDS.altitude + through * 1500;

const clip = (text: string, limit: number) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};
const dayMs = (day: string) => Date.parse(`${day}T12:00:00Z`);

export const byTime = (a: Experiment, b: Experiment) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.order - b.order || a.id.localeCompare(b.id));

/** A direction is on the sky when he says so; left unsaid, while it has work running or from the last three weeks. */
export function activeDirections(store: ExperimentStore): Set<string> {
  const latest = Math.max(0, ...store.experiments.map((e) => dayMs(e.when)));
  const active = new Set<string>();
  for (const direction of store.directions) {
    const mine = store.experiments.filter((e) => e.direction === direction.id);
    const recent = mine.some((e) => e.status === 'running' || (latest - dayMs(e.when)) / 864e5 <= ACTIVE_DAYS);
    if (direction.active ?? recent) active.add(direction.id);
  }
  return active;
}

/** Which experiments are on the sky, and on which ring. */
export function skyRings(store: ExperimentStore): Record<string, number> {
  const active = activeDirections(store);
  const sorted = [...store.experiments].sort(byTime);
  const latest = Math.max(0, ...sorted.map((e) => dayMs(e.when)));
  const rings: Record<string, number> = {};
  const mine = sorted.filter((e) => active.has(e.direction));
  for (const e of mine) if (e.status === 'running') rings[e.id] = 0; else if (e.flagged) rings[e.id] = 1;
  for (const id of active) {
    const last = [...mine].reverse().find((e) => e.direction === id && rings[e.id] === undefined);
    if (last) rings[last.id] = 2;
  }
  for (const e of [...mine].reverse()) if (rings[e.id] === undefined && (latest - dayMs(e.when)) / 864e5 <= RECENT_DAYS) rings[e.id] = 3;
  // Over the engine's limit, the outer rings give way first, oldest first.
  const kept = Object.keys(rings).sort((a, b) => rings[a]! - rings[b]! || byTime(sorted.find((e) => e.id === b)!, sorted.find((e) => e.id === a)!)).slice(0, SKY_MAX);
  return Object.fromEntries(kept.map((id) => [id, rings[id]!]));
}

/** An experiment as a Sunrise form: its direction and outcome, its question, and its answer as the line under it. */
export function experimentForm(e: Experiment, direction: Direction | undefined, ring: number | undefined): FormSpec {
  const name = clip(e.question, 60);
  const next = e.status === 'running' ? 'Running now' : e.status === 'planned' ? 'Planned' : ring === 1 ? 'Needs follow-up' : clip(e.answer, 60);
  // Its 3D picture comes first, and shows however small the form is: on the sky every experiment is its picture
  // with its name beside it, as a tile is.
  const parts: FormSpec['parts'] = [{ kind: 'media', look: `scene:${e.picture || 'stack'}`, from: 0 }];
  if (e.numbers.length > 0) parts.push({ kind: 'chips', items: e.numbers.slice(0, 4).map((n) => clip(n, 40)) });
  if (e.notes.trim() !== '') parts.push({ kind: 'quote', text: clip(e.notes, 160), by: 'your note' });
  return {
    id: taskId(e.id), listType: 'want-to-do', shape: 'tile', icon: e.status === 'running' ? 'timer' : e.status === 'planned' ? 'clock' : e.status === 'worked' ? 'check' : e.status === 'finding' ? 'spark' : 'chart',
    kind: `${direction?.name ?? 'No direction'} · ${STATUS_WORDS[e.status].toLowerCase()}`, name, next,
    what: clip(e.answer || e.details || 'No result yet.', 240), did: [],
    say: [name.replace(/[.…]*$/, ''), e.status === 'running' ? 'Running now.' : e.status === 'planned' ? 'Planned, not started.' : clip(e.answer, 120)],
    // Not ready in Sunrise's sense: OpenClaw has started nothing here, so the workspace credits it with nothing.
    parts, ready: false, hasWork: false, filling: e.status === 'running',
  };
}

export function experimentsView(store: ExperimentStore, now: Date): ExperimentsView {
  const experiments = [...store.experiments].sort(byTime);
  const directionOf = new Map(store.directions.map((d) => [d.id, d]));
  const active = activeDirections(store);
  const sky = skyRings(store);
  const forms: Record<string, FormSpec> = {};
  for (const e of experiments) forms[taskId(e.id)] = experimentForm(e, directionOf.get(e.direction), sky[e.id]);
  const items: HorizonItem[] = [];
  for (const ring of [0, 1, 2, 3]) {
    // Within a ring the newest sits nearest the sun.
    const here = experiments.filter((e) => sky[e.id] === ring).reverse();
    here.forEach((e, index) => {
      const through = here.length < 2 ? 0.4 : 0.12 + 0.76 * index / (here.length - 1);
      const name = directionOf.get(e.direction)?.name ?? 'Other';
      items.push({
        id: taskId(e.id), listType: 'want-to-do', title: e.question, short: clip(e.question, 44), label: name, group: name,
        weight: 5 - ring, due: '', implied: false, hours: ringHours(ring, through), zone: ZONES[ring]!, day: e.day, left: '',
      });
    });
  }
  const sunrise: SunriseData = {
    horizon: {
      now: now.toISOString(), items, further: [], holds: [], stale: [], undated: [], undatedRest: [], wants: [], wantTracks: [], wantsBySection: {},
      cleared: [], dailies: [], dailyWeek: [],
      hiddenStale: 0, letGoThisWeek: 0, bounds: BOUNDS,
    },
    forms, today: [], current: {}, started: {},
  };
  return {
    project: store.project,
    directions: [...store.directions].sort((a, b) => a.order - b.order).map((d) => ({ ...d, active: active.has(d.id), count: experiments.filter((e) => e.direction === d.id).length })),
    experiments, sky, sunrise,
  };
}
