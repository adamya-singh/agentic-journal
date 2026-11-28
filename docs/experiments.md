# Experiments

`/experiments` is the record of a project's experiments, shown on Sunrise's sky.

- **The sky** is Sunrise's own engine (`src/components/sunrise/engine.ts`), given the record as
  `src/lib/experiments/sunrise.ts` reads it. The sun is today. Each active direction of work is a slice. Running
  experiments sit nearest the sun, then the ones flagged for follow-up, then each direction's latest result, then
  other results from the last two weeks. The engine holds 16 things, so the sky holds at most that many.
- **Under the horizon** (`ExperimentHistory.tsx`) is the whole record: the experiments on the sky first, above a bar, then everything else, newest at the top and the project's start at
  the bottom, one line per direction beside the timeline.
- Pressing an experiment anywhere opens the same workspace a task gets (`TaskPane`, with `record`): the Work
  surfaces, web tabs and chats with OpenClaw, kept under the id `exp-<number>`. The head of its brief is
  `ExperimentPane.tsx`: the 3D picture, the result, the network, notes, groups, the follow-up flag, its outcome and
  its fields. `/experiments?open=36` opens one directly.
- The workspace's services learn of an experiment through `lib/experiments/brief.ts`: `loadTaskBrief` answers with
  the experiment's brief, and `workspaceRef` (brief/build.ts) lets the work and workspace stores accept its id.
  Experiments are not tasks: they are on no list and cannot be handed to OpenClaw's task work, done or let go.

## Write-ups

An experiment's workspace opens on two tabs of its own (`ExperimentWork.tsx`, given to `TaskPane` as `sheets`):

- **Understand it** reads top to bottom in the order the `experiment-analyze-explain` skill explains a result: the
  short version (question, what is measured, outcome), the setup, one block per part (why, what we did, what was
  predicted and whether it held, a table with its baseline rows, the conclusion), "Can I trust it?", what it means
  and what next (each follow-up is one press from being an experiment), and the research-log entry, folded.
- **Run and watch** has the status line, links to videos and curves, the command to run it live, the stages,
  housekeeping and the files.

  When the write-up has a post (`run.post`, drawn by `ExperimentPost.tsx`), the tab is that post under the status
  line and the lists are not shown. A post is a title (the question), a TL;DR and up to 12 sections. Each section
  has a `name`, a `gist` (a sentence or two: all that shows at first), a `story` (one zoom in) and a `detail` (two
  zooms in, may be empty). He zooms one section with its − and + or by pressing the gist, and all of them with the
  Gist / Story / Everything control, which stays in view and keeps the section he is reading in place. `story` and
  `detail` are lists of blocks: `text` (markdown), `listing` (fixed-width lines; "ok" and "failed" are coloured),
  `table`, `command`, `files`, and `figure` with a `caption`. A figure is `bars` (a scoreboard out of `of`), `lines`
  (curves, with `marks` for level lines, `end` labels and `callouts`), `outcomes` (a grid of small bars, one per
  try, each character of a cell a `legend` code) or `columns` (one upright bar per case). Colours are tones:
  `accent`, `blue`, `soft`, `grey`, `good`, `bad`, `warn`. The numbers in a figure are read from the run's files
  by whoever writes it, with code.

The work's own tab appears beside them once there is work in it; web tabs open as before. The "Ask OpenClaw"
buttons open a new chat with the question written in it, for him to send.

The content is the experiment's write-up (`Writeup` in `lib/experiments/types.ts`), kept in
`experiments/writeups.json` (`lib/experiments/writeups.ts`; `seed-writeups.ts` has experiment 53's). Whoever
analysed the run writes it: `PUT /api/experiments/writeup` with `{id, writeup}` replaces the whole write-up
(`writeup: null` removes it), `GET /api/experiments/writeup?id=53` reads it. Every field may be left out. A table's
rows are `{cells, mark}` with `mark` `'baseline'`, `'ours'` or `''`; a prediction's `result` is `held`, `failed`,
`half` or `open`; a stage's `state` is `done`, `trouble`, `running` or `waiting`; a `watch` link is http(s) or empty.
An experiment with no write-up shows what the record says and a request to copy for whoever will write it. A chat's
first turn carries the write-up's outcome and conclusions (`writeupSummary`).

Every experiment has a 3D picture (`picture`, a key of `scene-library.js`) and may name the network it trained
(`model`). `scenes.ts` draws them all with one off-screen WebGL renderer, copied onto 2D canvases, and only while
they are on screen. On the sky a form's picture is a `media` part whose look is `scene:<key>`: `lib/shapes/render.ts`
draws it as an empty canvas and the page starts the scene on it.

The record is `experiments/experiments.json` under the backend data dir (`src/lib/experiments/store.ts`). A machine
with no file starts from `seed.ts`, the SO-ARM-101 record as of 2026-11-22, and writes the file on the first change.

`GET /api/experiments` returns the record and the sky. `POST /api/experiments` makes one change and returns both
again: `{op: 'update', id, patch}`, `{op: 'create', experiment?}`, `{op: 'remove', id}`,
`{op: 'direction', id, active: true | false | null}`, `{op: 'add-direction', name}`.

A direction is on the sky when its `active` is true. Left unset, it is on the sky while it has an experiment running
or one from the last three weeks.

The engine takes a fourth argument, `EngineOptions`, for a page other than home: ring names, the word on the sun,
one side only, a picture on every form, the quiet headline, the line under it, the workspace's width. Home passes none and is unchanged.
