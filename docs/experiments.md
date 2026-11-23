# Experiments

`/experiments` is the record of a project's experiments, shown on Sunrise's sky.

- **The sky** is Sunrise's own engine (`src/components/sunrise/engine.ts`), given the record as
  `src/lib/experiments/sunrise.ts` reads it. The sun is today. Each active direction of work is a slice. Running
  experiments sit nearest the sun, then the ones flagged for follow-up, then each direction's latest result, then
  other results from the last two weeks. The engine holds 16 things, so the sky holds at most that many.
- **Under the horizon** (`ExperimentHistory.tsx`) is everything else, newest at the top and the project's start at
  the bottom, one line per direction beside the timeline.
- Pressing an experiment anywhere opens it in Sunrise's workspace (`ExperimentPane.tsx`): notes, groups, the
  follow-up flag, its outcome and its fields. `/experiments?open=36` opens one directly.

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
