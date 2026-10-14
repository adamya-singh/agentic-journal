# Compass page

Open `/compass`. OpenClaw keeps Adamya's compass in its own git repo at `~/.openclaw/workspace/compass/`: a **short-term compass** (the dated period of 3–12 weeks with ranked Focus bets, a Not-now list and a `## For agents` rulebook) and **long-term mirrors** of `USER.md`, `MEMORY.md` and `SOUL.md`. OpenClaw drafts, Adamya approves on Telegram, OpenClaw commits and pushes. The Journal only reads: this page never edits the repo, and nothing here calls out to GitHub.

The page is one read of the repo on load, on Refresh, and when the tab becomes visible again (no polling). It wears the same Horizon Dawn look as Bugs/Features.

## What the page shows

- **Hero**: the period id, title, dates (`Oct 14 – Dec 22, 2026 · review by Dec 6 · v1 · updated Oct 14`), the status pill, a progress track with a tick at `review_by` ("Day 12 of 70" / "58 days left"), the HEAD commit, and the Short-term | Long-term toggle (`?compass=long` deep-links it; the choice is remembered in `localStorage`).
- **Short-term**: the Period text as a lead, the Focus bets as numbered cards, Relation / Not now / Flow / Signals as cards, any extra H2 after them, and `## For agents` collapsed in a terminal block (those rules are OpenClaw's; they are shown, not hidden). Parse problems (missing keys, out-of-order sections, the >7,000-character size note) appear in an amber line.
- **Long-term**: the three mirrors as cards, each quoting only its North Star block: USER.md from `**Core North Star (Canonical):**` through the `**Scoreboard:**` bullet, MEMORY.md's `## North Star Anchor`, SOUL.md's `## Canonical North Star`. The rest of MEMORY.md is never sent to the page. The note turns amber when the last mirror change is older than 48 h or when there is no git history to date it.
- **Periods**: a timeline of every recorded period (Current / Closed / Unfinished, log entry count, retro, snapshot, the period-length verdict) with any pending draft first. A draft says **Awaiting your approval on Telegram** until its front matter carries `approved:`, then **Approved, opens <start>**. Clicking a period opens a sheet with tabs Compass (the final snapshot, or the live file while the period is open), Log (newest first) and Retro; `?period=<id>` deep-links it.
- **Changes**: the git log filtered to Short (`short-term/`), Long (`long-term/`) or All, 30 → 100 → 200 commits, with the author (OpenClaw, Adamya, compass-sync), the `compass(kind)` chip and the relative time. Clicking a commit expands its unified diff (capped at 200 KB, 4,000 rendered lines, with Copy).

## Repo layout the reader expects

```
short-term/compass.md                 the live compass (flat front matter + seven H2s)
short-term/periods/<start>--<end>/    log.md, retro.md, compass.md (final snapshot)
short-term/drafts/<start>--<end>.md   pending next-period proposal
long-term/USER.md MEMORY.md SOUL.md   byte-for-byte mirrors kept by compass-sync
```

Front matter is flat `key: value` only (`kind`, `period`, `title`, `start`, `end`, `review_by`, `updated`, `version`; optional `opened`, `closed`, `approved`, `approved_by`). The seven sections are `Period`, `Relation to the long-term compass`, `Focus`, `Not now`, `Flow`, `Signals`, `For agents`, in that order. Log entries are `## YYYY-MM-DD — pulse|chat|system[ — title]`; the reader also accepts `-`, `–` and `(source)`. A retro's verdict comes from its `verdict:` key, else from its `## Period-length verdict` section.

## Status

Computed from New York calendar dates compared as strings; "today" is computed on the server and sent with the overview.

| status | when |
|---|---|
| `closed` | the front matter has `closed:` |
| `upcoming` | today < `start` |
| `expired` | today > `end` (the compass stays in force; For agents is advisory) |
| `review-due` | `review_by` ≤ today ≤ `end` |
| `active` | otherwise |

## Environment

- `OPENCLAW_COMPASS_DIR` — the repo; default `/home/openclaw/.openclaw/workspace/compass`. `.env` sets it to the default explicitly.
- `OPENCLAW_COMPASS_GIT` — the git binary (default `git`); tests set it to a non-existent path to exercise the no-git state.

Git runs as `git -C <dir> -c color.ui=never -c core.quotePath=false …` with a 5 s timeout, an 8 MB output cap, every `GIT_*` variable stripped from the environment, `GIT_TERMINAL_PROMPT=0` and `LC_ALL=C`. A `compass/` folder that was never `git init`ed is **not** read through the parent `~/.openclaw` repository: `rev-parse --show-toplevel` must equal the directory itself.

## API (GET only)

```
GET /api/compass                                  → CompassOverview
GET /api/compass/history?scope=short|long|all&limit=1..200   → CompassHistory (200 with commits:[] + error when git or the repo is missing)
GET /api/compass/history/<sha>                    → CommitDetail | 404
GET /api/compass/periods/<start>--<end>           → PeriodDetail | 404
```

Responses are `{ success, data }` with `Cache-Control: no-store`. Out-of-range query values fall back to their defaults (`scope=short`, `limit=30`). Unknown paths, bad shas and ids that do not match `YYYY-MM-DD--YYYY-MM-DD` are 404s; only an unexpected filesystem error is a 500.

## Degraded states

| situation | page |
|---|---|
| `OPENCLAW_COMPASS_DIR` missing | hero "No compass yet" with the path; empty timeline; "No git history" |
| directory present, not a repo | compass renders; Changes shows git's first stderr line (which carries the `safe.directory` hint when ownership is the problem) |
| git not installed | compass renders; Changes shows the install hint; mirror time falls back to file mtimes |
| no mirrors yet | Long-term view explains compass-sync fills `long-term/` |
| a mirror is a symlink or lacks its marker | flagged on its card and in the problems line |

## Using the reader from other features

```ts
import { readShortTermCompass, readLongTermCompass } from '@/lib/compass';

const short = readShortTermCompass(); // { available, title, period, status, sections, forAgents, problems, … }
const long = readLongTermCompass(); // { available, text, parts.{user,memory,soul}, mirroredAt, … }
```

Both take an optional directory (default `compassDir()`); `readShortTermCompass` also takes `today`. Client components import `@/lib/compass/types`, `@/lib/compass/dates` and `@/lib/compass/markdown-sections` directly; the barrel pulls in `fs` and `child_process`. The Media feed's `src/lib/media/compass.ts` adapts these into its own `Compass` shape (and falls back to the live workspace files until the first mirror sync).

## Validation

`node --test --import ./scripts/test-register.mjs scripts/compass.test.ts` builds a fixture repo in a temp dir (the seed compass, two closed periods, one draft, mirrors shaped like the real files) and covers front matter edge cases, fence-aware section splitting, the status table and the New York midnight boundary, long-term extraction, period listing with a synthesised current period, drafts (none / one / two), snapshot vs live period reads and traversal attempts, commit listing by scope and author, the 200 KB diff cap, the nested-repo guard, the API 200/404 matrix, the missing-directory state and the no-git seam. The git cases skip when git is not installed.
