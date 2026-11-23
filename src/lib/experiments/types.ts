// The experiment record: every experiment of a project, by direction of work. The Experiments page shows it on
// Sunrise's sky (what is in play now) and under the horizon (the history, back to the project's start).
import type { SunriseData } from '../sunrise/data.ts';

export const EXPERIMENT_STATUSES = ['worked', 'failed', 'mixed', 'finding', 'running'] as const;
export type ExperimentStatus = typeof EXPERIMENT_STATUSES[number];
export const STATUS_WORDS: Record<ExperimentStatus, string> = { worked: 'Worked', failed: "Didn't work", mixed: 'Partly', finding: 'Finding', running: 'Running' };

export interface Experiment {
  id: string;            // "07": its number, in the order it was run
  when: string;          // YYYY-MM-DD, the day it started
  day: string;           // the date as shown: "Aug 3", "Nov 12–17"
  order: number;         // breaks ties between experiments on the same day
  direction: string;     // a Direction's id
  status: ExperimentStatus;
  question: string;
  answer: string;        // one line; '' while it runs
  numbers: string[];     // the few figures that carry the result
  details: string;
  buildsOn: string[];    // ids of earlier experiments; the first is the one it grew out of
  notes: string;         // his own notes
  flagged: boolean;      // needs follow-up
  groups: string[];      // his own groupings; an experiment can be in several
  picture: string;       // which 3D scene stands for it (components/experiments/scenes.ts's PICTURES)
  model: string;         // the network it trained, drawn in its workspace: one of MODELS, or ''
}

export interface Direction {
  id: string;
  name: string;
  hue: number;           // 0 to 9: which of the page's ten colours
  order: number;
  active?: boolean;      // on the sky. Left out, a direction is active while it has recent or running work.
}

export interface ExperimentStore {
  version: 1;
  project: string;
  directions: Direction[];
  experiments: Experiment[];
}

/** The networks the experiments trained: a name and a line about it, by key. */
export const MODELS: Record<string, readonly [string, string]> = {
  mlp: ['The step-by-step clone', 'One small network, one action per look.'],
  chunk: ['The chunk policy', 'Same inputs, but one look now produces 3 seconds of motion.'],
  cnn: ['The vision policy (CNN, 2.71M weights)', 'The v2 trunk is shown. Runs before Sep 10 used the older v1 trunk, which shrank the image to a 4×4 grid.'],
  act: ['ACT (51.6M weights)', 'It runs the first 30 of its 90 planned steps, then looks again.'],
  pi05: ['pi0.5 with LoRA rank 16', 'A pretrained vision-language-action model; only small adapter weights were trained, for 10k steps.'],
};

/** Which ring of the sky an experiment in play sits on, nearest the sun first. */
export const SKY_RINGS = [
  ['Running', 'right now'], ['Follow up', 'flagged'], ['Latest', 'per direction'], ['Recent', 'last two weeks'],
  // Past the fourth ring: what is in play but found no room nearer the sun.
  ['Also in play', 'no room nearer'], ['', ''], ['', ''], ['', ''],
] as const;

export interface ExperimentsView {
  project: string;
  directions: (Direction & { active: boolean; count: number })[];
  experiments: Experiment[];          // all of them, oldest first
  sky: Record<string, number>;        // id -> ring, for the ones on the sky
  sunrise: SunriseData;               // the sky as Sunrise's engine reads it; there an experiment's id is "exp-<number>"
}

// ---- The write-up of one experiment: what its workspace shows in "Understand it" and "Run and watch".
export const PREDICTION_RESULTS = ['held', 'failed', 'half', 'open'] as const;
export const PREDICTION_WORDS: Record<typeof PREDICTION_RESULTS[number], string> = { held: 'Held', failed: 'Failed', half: 'Half', open: 'Not yet known' };
export const STAGE_STATES = ['done', 'trouble', 'running', 'waiting'] as const;

export interface WriteupPart {
  title: string;                       // "Do the two skills stack in one policy?"
  why: string;
  did: string;
  predictions: { text: string; result: typeof PREDICTION_RESULTS[number] }[];   // written down before the run
  table: { head: string[]; rows: { cells: string[]; mark: '' | 'baseline' | 'ours' }[] } | null;   // a number needs its baseline in the same table
  conclusion: string;
}
export interface Writeup {
  // Understand it
  question: string;                    // the short version: what it asks,
  measure: string;                     // what is measured,
  outcome: string;                     // and what came out
  setup: string;                       // what a new intern needs to know first
  parts: WriteupPart[];
  trust: { text: string; ok: boolean }[];   // fair-comparison checks (ok) and limits (not ok)
  meaning: string;                     // what it means for the decision
  lesson: string;                      // the one lesson
  next: { title: string; why: string }[];   // follow-ups, each one press from being an experiment
  log: string;                         // the research-log entry, as markdown
  // Run and watch
  run: {
    state: string;                     // "Finished" or "Running: order, 9 of 18 trainers"
    line: string;                      // "Nov 21 · 6 of 6 stages · nothing left in the queue"
    watch: { title: string; note: string; href: string }[];   // videos and curves; href may be ''
    command: string;                   // how to run it live on the training machine
    stages: { name: string; note: string; state: typeof STAGE_STATES[number] }[];
    housekeeping: { text: string; ok: boolean }[];
    files: { path: string; note: string }[];
  };
  updated: string;                     // ISO time it was last written
}
