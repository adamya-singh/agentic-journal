import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { frontMatterInt, parseFrontMatter } from '../src/lib/compass/front-matter.ts';
import {
  compassStatus,
  daysBetween,
  formatPeriodRange,
  isIsoDate,
  periodProgress,
  todayInNewYork,
  weeksInclusive,
} from '../src/lib/compass/dates.ts';
import {
  extractBulletBlock,
  extractH2Section,
  parseLogEntries,
  retroVerdict,
  splitCommitSubject,
  splitH2Sections,
  splitTopLevelItems,
} from '../src/lib/compass/markdown-sections.ts';
import {
  DEFAULT_COMPASS_DIR,
  PERIOD_ID_RE,
  compassDir,
  listPeriods,
  parseShortTermMarkdown,
  readDraft,
  readDrafts,
  readLongTermCompass,
  readOverview,
  readPeriod,
  readShortTermCompass,
} from '../src/lib/compass/read.ts';
import {
  authorKind,
  commitKind,
  gitAvailable,
  isCompassRepo,
  listCommits,
  listHistory,
  repoInfo,
  resetGitCacheForTests,
  showCommit,
  stripUserinfo,
} from '../src/lib/compass/git.ts';
import { SHORT_TERM_SECTIONS } from '../src/lib/compass/types.ts';
import { GET } from '../src/app/api/compass/[[...path]]/route.ts';

// ---------- fixtures ----------

const SEED_ID = '2026-10-14--2026-12-22';
const P1 = '2026-07-01--2026-08-31';
const P2 = '2026-09-01--2026-10-13';
const DRAFT = '2026-12-23--2027-01-18';

// The plan's A5 seed, verbatim.
const SEED = `---
kind: short-term
period: 2026-10-14--2026-12-22
title: Finish Fall 2026 strong and convert the job pipeline into Spring 2027 / new-grad offers
start: 2026-10-14
end: 2026-12-22
review_by: 2026-12-06
updated: 2026-10-14
version: 1
---

<!-- SEED DRAFTED BY CLAUDE CODE ON 2026-10-13. Adamya: edit freely (bets, "done looks like", Not now, the For-agents bars), then approve before the first commit. Numbers marked (?) are proposals, not measurements. -->

# Compass — Oct 14 → Dec 22, 2026

## Period
Ten weeks, ending the day Fall 2026 finals end (Rutgers: last class Thu Dec 10, reading days Dec 11 and 14, finals Dec 15-22). Shorter would cut across finals; longer would mix winter break, the January 2027 graduation, and offer decisions, which deserve their own short period (likely a 4-week bridge Dec 23 → Jan 18, 2027, before Spring starts Jan 19). Flow reasoning: the semester imposes a fixed rhythm (Monday is a three-class day, Tuesday evening Regression; midterms Oct 15 and Oct 26; presentations Oct 26, Nov 16, Nov 30), so build time lives Wed-Sun. Trajectory reasoning: the exponential path requires converting capability into leverage now; 2027 new-grad hiring is active this quarter and graduation is three months out, so this period compresses to three bets and parks everything else. First period: no prior retro, so the period-length verdict is open.

## Relation to the long-term compass
- Advances: the high-leverage AI role track (OpenAI-path) through a selective, high-volume pipeline; capability depth in agentic systems and GPU work (Agentic Journal, OpenClaw, a CUDA project); product traction via the Journal as a working, demonstrable system.
- Deprioritizes: the startup-building track (no new ventures or prototypes this period); Stanford CS336/CS224N coursework tracks; robotics and console side projects.
- Why now: graduation January 2027 makes this the last full semester; Spring 2027 and new-grad windows close over the next 6-10 weeks; the course load peaks with four classes and three presentations.

## Focus
1. **Convert the job pipeline into offers (Spring 2027 internships that accept a Jan 2027 grad, and new-grad roles) in AI/ML, inference, infra, agents, GPU.** Done looks like: at least 2 final-round processes live or 1 offer by Dec 22 (?); the applications worker keeps roughly 5 quality applications/day; every applied role has notes naming the bet it advances; a small CUDA/GPU project is public with a resume line by Nov 15 (?); 1 LeetCode problem/day maintained.
2. **Make Agentic Journal + OpenClaw the proof of capability.** Done looks like: the job-applications page deep UI in production by Nov 20 (?); the compass loop running (this file, weekly Pulse, one closed period with a retro); one public writeup or demo of the system by Dec 10 (?).
3. **Close out Fall 2026 cleanly and stay on track to graduate January 2027.** Done looks like: no missed deadline across Data Context, Info Viz, Stat Learning, Regression; midterms Oct 15 and Oct 26 and presentations Oct 26, Nov 16, Nov 30 prepared at least 48 h ahead; finals Dec 15-22 taken with no all-nighters; the January 2027 diploma application (due Jan 15, 2027) carried into the next period.

## Not now
- Stanford CS336 and CS224N summer tracks (110 queued tasks; CS336 roadmap dates have passed with every checkpoint not started). Revisit in the Dec 23 bridge period or Spring.
- SO-ARM-101 / xArm robotics, PS4 homebrew, drone parts.
- rutgers-soc-agent (Rutgers scheduling agent, iOS app) until winter break.
- New OpenClaw skills or integrations that do not serve bet 1 or 2 (smart glasses, locations skill, self-text ingestion).
- Sitting in on CS 417/545 Distributed Systems: optional; attend only when no bet-1 or bet-3 deadline falls within 48 h.
- Fall 2026 internships/co-ops: only the exceptional ones (bar in For agents).

## Flow
- What keeps the weeks in flow: Monday is a class day (12:10 Data Context, 3:50 Info Viz, 7:30-10:30 pm Stat Learning), Tuesday 5:40 pm Regression; treat Mon/Tue as low-build days and Wed-Sun as build days with one 3-hour deep-work block on bet 1 or 2 each build day. The three dailies (apply 30 min, 1 LeetCode, 10-minute workout) run before deep work. Exam-eve rule: 48 h before Oct 15, Oct 26, and each final, only bet 3 plus the dailies.
- What breaks it: context-switching into Not-now projects; Journal production incidents during build blocks (never redeploy while a deploy is running, see AGENTS.md); capture overflow into Current; late-night coding before exams; letting the pipeline go quiet during midterm weeks (Oct 12-16, Oct 19-26).

## Signals
Checked by the weekly Pulse (via compass.py pulse-inputs):
- Pipeline: applications applied per week (baseline 9; target >= 10 (?)), new interviews/OAs (target >= 1 per two weeks (?)), applied total.
- Execution: analyze-completion completion rate (baseline 15%; target >= 30% (?)), analyze-plan-actual miss rate (baseline 31%; target <= 25% (?)).
- Focus: count of Current tasks outside bets 1-3 (target <= 3), completed tasks this week mapped to each bet (no bet silent for two consecutive weeks).
- Bet 3: zero overdue course tasks; each exam/presentation prepared 48 h ahead.
- Flow: build days with a logged 3-hour block (target >= 4/week (?)); number of Not-now items that leaked into Today.

## For agents
These rules expire on 2026-12-22. They override the generic bars in skill and rule files while this period is active.
- Job postings (daily sweep, job-fit-rules): favor \`new-grad\` and roles starting Jan-Jul 2027 in AI/ML, inference, infra, agents, evals, CUDA/GPU, developer tools, strong startups and labs. \`spring-internship\` listings: save only if the posting clearly accepts a January 2027 graduate or a degree-by-start candidate; otherwise report \`needs review\`, never silently assume eligibility. \`fall-internship\`/co-op (Fall 2026): Adamya is busy during the Fall 2026 semester and would only accept one that is unusually strong for his North Star; apply a higher bar than for new-grad roles and save only with several of these signals: direct frontier-AI, AI-infrastructure, agents, evals, retrieval, model, data, inference, CUDA/GPU, or systems work; a strong startup, AI lab, elite engineering team, or unusually high-signal technical environment; meaningful ownership, ambiguity, or fast product loops rather than generic intern task execution; clear eligibility for a Rutgers undergrad and clear Fall 2026 timing; practical upside that justifies semester disruption (mentorship, compensation, location/remote practicality, career compounding). Do not save generic Fall 2026 SWE internships/co-ops, low-signal companies, roles with unclear Fall timing, or roles that would disrupt the semester without exceptional upside; mention them only as skipped or low priority if useful. In \`Pros:\` name the Focus bet a role advances.
- Capture prioritization: admit to Current only if due within 7 days, or it directly advances bet 1, 2, or 3, or it is a hard external commitment (money owed, a person waiting). Not-now items: skip with reason "not now per compass: <line>". Keep Current at or under 12. Within 48 h before Oct 15, Oct 26, or any final (Dec 15-22), admit nothing that is not due within 7 days.
- Morning pick: before Dec 10, offer only want-to-do items tagged openclaw or agentic-journal that serve bet 1 or 2, plus the CUDA project; Dec 11-22 offer at most light items (under 1 hour). Offer at most one Not-now item per week, labeled as such.
- Check-ins: during Dec 15-22 ask only the required question and at most one follow-up.
- Feed/bookmark/media judging: prioritize content on agents, evals, inference, CUDA/GPU, new-grad AI hiring, and interview prep; deprioritize robotics, consoles, generic productivity.
- Pulse: send the retro and next-period draft for approval on or before Dec 6; propose a short bridge period (about 4 weeks, Dec 23 → Jan 18, 2027) unless the pipeline state argues otherwise.
`;

function compassMd(o: {
  id: string;
  title: string;
  reviewBy: string;
  updated: string;
  version: number;
  opened?: string;
  closed?: string;
  approved?: string;
  approvedBy?: string;
  focus?: string;
}) {
  const [start, end] = o.id.split('--');
  const extra = [
    o.opened ? `opened: ${o.opened}` : '',
    o.closed ? `closed: ${o.closed}` : '',
    o.approved ? `approved: ${o.approved}` : '',
    o.approvedBy ? `approved_by: ${o.approvedBy}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `---
kind: short-term
period: ${o.id}
title: "${o.title}"
start: ${start}
end: ${end}
review_by: ${o.reviewBy}
updated: ${o.updated}
version: ${o.version}
${extra}${extra ? '\n' : ''}---

# Compass — ${o.id}

## Period
Why these dates.

## Relation to the long-term compass
- Advances: capability depth.
- Deprioritizes: side quests.
- Why now: because.

## Focus
${o.focus ?? '1. **Ship.** Done looks like: shipped.\n2. **Land.** Done looks like: landed.'}

## Not now
- Robotics.

## Flow
Build days Wed-Sun.

## Signals
- Applications per week.

## For agents
- Job postings: favor new-grad.
`;
}

const P1_LOG = `# Log — ${P1}

## 2026-07-01 — system — opened
Period opened from draft ${P1}.

## 2026-07-05 — pulse — week of 2026-07-05
**Window:** Jul 1 – Jul 5
**Done vs planned:** 4 of 9.

\`\`\`
## 2026-07-06 — not an entry, inside a fence
\`\`\`
`;

const P2_LOG = `# Log — ${P2}

## 2026-09-01 - system - opened
Opened.

## 2026-09-07 – pulse – week of 2026-09-06
Quiet week.

## 2026-09-20 (chat) a note from Telegram
Adamya: keep the pipeline warm.

## 2026-09-20 — chat
Second note the same day.

## 2026-10-13 — system — closed
Closed by the Pulse.
`;

const P1_RETRO = `---
kind: retro
period: ${P1}
closed: 2026-08-31
verdict: right
---

# Retro — ${P1}

## What happened
Shipped the Journal media page.

## What advanced the long-term compass
Capability depth.

## What broke flow
Travel.

## Carry forward
The pipeline.

## Period-length verdict
Nine weeks felt **too long** on paper but the front matter says right; the front matter wins.
`;

const P2_RETRO = `---
kind: retro
period: ${P2}
closed: 2026-10-13
---

## What happened
Six weeks of classes.

## What advanced the long-term compass
Little.

## What broke flow
Midterms.

## Carry forward
Finish Fall.

## Period-length verdict
**too short** — the semester rhythm wanted ten weeks.
`;

// Shaped like the real ~/.openclaw/workspace files (headings, bullets, footer), with stand-in text.
const USER_MD = `# USER.md - About Your Human

*Learn about the person you're helping. Update this as you go.*

- **Name:** Adamya Singh
- **What to call them:** Adamya
- **Timezone:**
- **Notes:**

## Context

- **Graduation:** January 2027, one semester early.
- **Job application priorities:** Spring 2027 and new-grad roles.


- **Core North Star (Canonical):**
  "Ultimate objective is to be a primary architect of the AI future, either by securing a high-leverage role at OpenAI or by building a category-defining AI startup."
- **Shared Mission Model:** Adamya and OpenClaw operate in symbiosis.
- **Decision Priority:** Choose the path with highest compounding leverage, not prestige optics.
- **Operating Preference:** High-intensity, founder-mode execution.
- **Scoreboard:** Capability depth in agentic/gen-AI systems plus real-world product traction.
- **Consent preference:** For interactive MacBook/Windows tasks, propose one high-level plan and wait for acceptance.

---

The more you know, the better you can help.
`;

const MEMORY_MD = `# Long-Term Memory (Adamya Singh)

## North Star Anchor
- **Canonical Mission:** "Ultimate objective is to be a primary architect of the AI future."
- **Trajectory:** Dual-track by design.
- **Anti-Drift Rule:** Avoid project-only output, capability stagnation, and fragmentation.

## 🎓 Academic Goals
- **Dual Major:** Computer Science (BS) and Data Science (BS).

## 🛠️ Personal System (OpenClaw)
- **Agentic Journal:** Uses a custom CLI for task management.

<!-- resume-overleaf: start -->
## Resume source of truth (Adamya)

Overleaf is the oracle.
<!-- resume-overleaf: end -->
`;

const SOUL_MD = `# SOUL.md - Who You Are

_You are not a chatbot._

## Symbiosis Doctrine

Adamya and OpenClaw operate as one coordinated cognitive system.

## Canonical North Star

> "Ultimate objective is to be a primary architect of the AI future, either by securing a high-leverage role at OpenAI or by building a category-defining AI startup."

Operational principles:
- Systemic influence over maintenance output.
- Execution speed is a strategic weapon.

## Operating Protocol

- Prioritize actions that increase long-term compounding leverage.

---

_This file is alive._
`;

const README_MD = '# Compass\n\nAdamya\'s compass: short-term periods and long-term mirrors.\n';
const LONG_README = '# Long-term compass (mirrors)\n\nEdit the originals in the OpenClaw workspace.\n';

function write(root: string, rel: string, text: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** The repo layout: the seed as the live compass, two closed periods, one draft, three mirrors. */
function buildFixture(root: string) {
  write(root, 'README.md', README_MD);
  write(root, '.gitignore', '.scratch/\n__pycache__/\n');
  write(root, 'long-term/README.md', LONG_README);
  write(root, 'long-term/USER.md', USER_MD);
  write(root, 'long-term/MEMORY.md', MEMORY_MD);
  write(root, 'long-term/SOUL.md', SOUL_MD);
  write(root, 'short-term/compass.md', SEED);
  write(
    root,
    `short-term/periods/${P1}/compass.md`,
    compassMd({
      id: P1,
      title: 'Summer: ship the Journal and land the internship',
      reviewBy: '2026-08-16',
      updated: '2026-08-31',
      version: 3,
      opened: '2026-07-01',
      closed: '2026-08-31',
    }),
  );
  write(root, `short-term/periods/${P1}/log.md`, P1_LOG);
  write(root, `short-term/periods/${P1}/retro.md`, P1_RETRO);
  write(
    root,
    `short-term/periods/${P2}/compass.md`,
    compassMd({
      id: P2,
      title: 'Settle into Fall and open the pipeline',
      reviewBy: '2026-09-27',
      updated: '2026-10-13',
      version: 2,
      opened: '2026-09-01',
      closed: '2026-10-13',
    }),
  );
  write(root, `short-term/periods/${P2}/log.md`, P2_LOG);
  write(root, `short-term/periods/${P2}/retro.md`, P2_RETRO);
  write(
    root,
    `short-term/drafts/${DRAFT}.md`,
    compassMd({
      id: DRAFT,
      title: 'Bridge: graduate, decide offers, rest',
      reviewBy: '2027-01-10',
      updated: '2026-12-06',
      version: 1,
    }),
  );
  fs.mkdirSync(path.join(root, 'short-term', 'periods'), { recursive: true });
}

let hasGit = false;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
  hasGit = true;
} catch {
  hasGit = false;
}

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

function git(dir: string, args: string[], extraEnv: Record<string, string> = {}) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...GIT_ENV, ...extraEnv },
  }).trim();
}

const AUTHORS = {
  adamya: ['Adamya Singh', 'adamya@example.com'],
  openclaw: ['OpenClaw', 'openclaw@ubuntu-laptop.local'],
  sync: ['compass-sync', 'compass-sync@ubuntu-laptop.local'],
  other: ['Other Person', 'other@example.com'],
} as const;

function commit(dir: string, who: keyof typeof AUTHORS, message: string, date: string): string {
  const [name, email] = AUTHORS[who];
  git(dir, ['add', '-A']);
  git(dir, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--no-verify', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
  return git(dir, ['rev-parse', 'HEAD']);
}

/** The fixture committed in the order OpenClaw would have produced it. */
function buildGitFixture(root: string) {
  const shas: Record<string, string> = {};
  git(root, ['init', '-q', '-b', 'main']);
  write(root, 'README.md', README_MD);
  write(root, '.gitignore', '.scratch/\n__pycache__/\n');
  write(root, 'long-term/README.md', LONG_README);
  write(root, 'long-term/USER.md', USER_MD.replace('Adamya Singh', 'Adamya'));
  write(root, 'long-term/MEMORY.md', MEMORY_MD);
  write(root, 'long-term/SOUL.md', SOUL_MD);
  shas.repo = commit(root, 'adamya', 'compass(repo): initial layout, long-term mirrors', '2026-07-01T09:00:00-04:00');
  write(
    root,
    'short-term/compass.md',
    compassMd({ id: P1, title: 'Summer: ship the Journal and land the internship', reviewBy: '2026-08-16', updated: '2026-07-01', version: 1, opened: '2026-07-01' }),
  );
  write(root, `short-term/periods/${P1}/log.md`, P1_LOG.split('\n## 2026-07-05')[0]);
  shas.open1 = commit(root, 'adamya', `compass(period): open ${P1}`, '2026-07-01T09:05:00-04:00');
  write(root, `short-term/periods/${P1}/log.md`, P1_LOG);
  shas.pulse = commit(root, 'openclaw', 'compass(pulse): week of 2026-07-05', '2026-07-05T18:00:00-04:00');
  write(root, 'long-term/USER.md', USER_MD);
  shas.mirror = commit(root, 'sync', 'compass(long): mirror USER.md', '2026-07-12T18:00:00-04:00');
  write(
    root,
    `short-term/periods/${P1}/compass.md`,
    compassMd({ id: P1, title: 'Summer: ship the Journal and land the internship', reviewBy: '2026-08-16', updated: '2026-08-31', version: 3, opened: '2026-07-01', closed: '2026-08-31' }),
  );
  write(root, `short-term/periods/${P1}/retro.md`, P1_RETRO);
  shas.close1 = commit(root, 'openclaw', `compass(period): close ${P1}`, '2026-08-31T18:00:00-04:00');
  write(
    root,
    'short-term/compass.md',
    compassMd({ id: P2, title: 'Settle into Fall and open the pipeline', reviewBy: '2026-09-27', updated: '2026-09-01', version: 1, opened: '2026-09-01' }),
  );
  write(root, `short-term/periods/${P2}/log.md`, P2_LOG);
  shas.open2 = commit(root, 'adamya', `compass(period): open ${P2}`, '2026-09-01T09:00:00-04:00');
  write(
    root,
    `short-term/periods/${P2}/compass.md`,
    compassMd({ id: P2, title: 'Settle into Fall and open the pipeline', reviewBy: '2026-09-27', updated: '2026-10-13', version: 2, opened: '2026-09-01', closed: '2026-10-13' }),
  );
  write(root, `short-term/periods/${P2}/retro.md`, P2_RETRO);
  shas.close2 = commit(root, 'openclaw', `compass(period): close ${P2}`, '2026-10-13T18:00:00-04:00');
  write(
    root,
    `short-term/drafts/${DRAFT}.md`,
    compassMd({ id: DRAFT, title: 'Bridge: graduate, decide offers, rest', reviewBy: '2027-01-10', updated: '2026-12-06', version: 1 }),
  );
  shas.draft = commit(root, 'openclaw', `compass(draft): bridge period ${DRAFT}`, '2026-10-13T18:05:00-04:00');
  write(root, 'short-term/compass.md', SEED);
  shas.openSeed = commit(root, 'adamya', `compass(period): open ${SEED_ID}`, '2026-10-14T08:00:00-04:00');
  write(root, 'README.md', README_MD + '\nTidied.\n');
  shas.other = commit(root, 'other', 'Tidy README', '2026-10-14T09:00:00-04:00');
  const big = Array.from({ length: 6000 }, (_, i) => `line ${i} ${'x'.repeat(44)}`).join('\n') + '\n';
  write(root, 'short-term/big.txt', big);
  shas.big = commit(root, 'openclaw', 'compass(repo): big file for the diff cap', '2026-10-14T10:00:00-04:00');
  return shas;
}

const ENV_KEYS = ['OPENCLAW_COMPASS_DIR', 'OPENCLAW_COMPASS_GIT'];
const savedEnv: Record<string, string | undefined> = {};
function saveEnv() {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetGitCacheForTests();
}

const req = (p = '') => new NextRequest(`http://localhost/api/compass${p}`);
async function call(p = '') {
  const res = await GET(req(p));
  return { status: res.status, body: await res.json() };
}

// ---------- pure helpers ----------

describe('front matter', () => {
  it('parses flat scalars, strips quotes, skips comments and blank lines', () => {
    const fm = parseFrontMatter('---\n# a comment\nkind: short-term\n\ntitle: "Finish Fall"\nnote: \'single\'\nversion: 2\n---\n# Body\n\ntext\n');
    assert.equal(fm.present, true);
    assert.deepEqual(fm.data, { kind: 'short-term', title: 'Finish Fall', note: 'single', version: '2' });
    assert.equal(fm.body, '# Body\n\ntext\n');
    assert.deepEqual(fm.problems, []);
  });
  it('treats a missing or unterminated block as plain markdown', () => {
    assert.deepEqual(parseFrontMatter('# No front matter\n'), { present: false, data: {}, body: '# No front matter\n', problems: [] });
    const open = parseFrontMatter('---\nkind: short-term\n# never closed\n');
    assert.equal(open.present, false);
    assert.equal(open.body, '---\nkind: short-term\n# never closed\n');
    assert.match(open.problems[0], /never closes/);
  });
  it('reports nested values and repeated keys instead of guessing', () => {
    const fm = parseFrontMatter('---\nfocus:\n  - nested\ntitle: a\ntitle: b\n---\nbody');
    assert.equal(fm.data.title, 'b');
    assert.equal(fm.data.focus, '');
    assert.equal(fm.problems.length, 2);
    assert.match(fm.problems[0], /line 3/);
    assert.match(fm.problems[1], /repeats the key "title"/);
  });
  it('accepts CRLF endings and a BOM, lower-cases keys', () => {
    const fm = parseFrontMatter('﻿---\r\nKind: short-term\r\nStart: 2026-10-14\r\n---\r\nbody\r\n');
    assert.deepEqual(fm.data, { kind: 'short-term', start: '2026-10-14' });
    assert.equal(fm.body, 'body\n', 'line endings are normalised');
  });
  it('reads positive integers only', () => {
    assert.equal(frontMatterInt('3'), 3);
    assert.equal(frontMatterInt(' 12 '), 12);
    assert.equal(frontMatterInt('0'), null);
    assert.equal(frontMatterInt('1.5'), null);
    assert.equal(frontMatterInt('abc'), null);
    assert.equal(frontMatterInt(undefined), null);
  });
});

describe('dates', () => {
  it('todayInNewYork follows the New York calendar across the UTC midnight boundary', () => {
    assert.equal(todayInNewYork(new Date('2026-10-14T03:59:00Z')), '2026-10-13'); // EDT, 23:59
    assert.equal(todayInNewYork(new Date('2026-10-14T04:00:00Z')), '2026-10-14');
    assert.equal(todayInNewYork(new Date('2026-12-22T04:59:00Z')), '2026-12-21'); // EST, 23:59
    assert.equal(todayInNewYork(new Date('2026-12-22T05:00:00Z')), '2026-12-22');
    assert.match(todayInNewYork(), /^\d{4}-\d{2}-\d{2}$/);
  });
  it('validates calendar dates and counts days without local time', () => {
    assert.equal(isIsoDate('2026-10-14'), true);
    assert.equal(isIsoDate('2026-02-30'), false);
    assert.equal(isIsoDate('2026-10-14T00:00'), false);
    assert.equal(isIsoDate(20261014), false);
    assert.equal(daysBetween('2026-10-14', '2026-12-22'), 69);
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2); // across the DST change
    assert.equal(daysBetween('2026-12-22', '2026-10-14'), -69);
    assert.equal(weeksInclusive('2026-10-14', '2026-12-22'), 10);
    assert.equal(weeksInclusive('2026-12-23', '2027-01-18'), 3.9);
  });
  it('compassStatus table', () => {
    const p = { start: '2026-10-14', end: '2026-12-22', reviewBy: '2026-12-06' };
    assert.equal(compassStatus({ ...p, closed: '2026-12-22' }, '2026-11-01'), 'closed');
    assert.equal(compassStatus(p, '2026-10-13'), 'upcoming');
    assert.equal(compassStatus(p, '2026-10-14'), 'active');
    assert.equal(compassStatus(p, '2026-12-05'), 'active');
    assert.equal(compassStatus(p, '2026-12-06'), 'review-due');
    assert.equal(compassStatus(p, '2026-12-22'), 'review-due');
    assert.equal(compassStatus(p, '2026-12-23'), 'expired');
    assert.equal(compassStatus({ start: p.start, end: p.end }, '2026-12-22'), 'active');
    assert.equal(compassStatus({ ...p, closed: '' }, '2026-12-23'), 'expired');
  });
  it('periodProgress counts inclusive days and clamps', () => {
    const p = { start: '2026-10-14', end: '2026-12-22', reviewBy: '2026-12-06' };
    const first = periodProgress(p, '2026-10-14');
    assert.equal(first.total, 70);
    assert.equal(first.elapsed, 1);
    assert.equal(first.left, 69);
    assert.equal(first.reviewPct, 75.7);
    const before = periodProgress(p, '2026-10-01');
    assert.equal(before.elapsed, 0);
    assert.equal(before.daysToStart, 13);
    const afterEnd = periodProgress(p, '2027-01-01');
    assert.equal(afterEnd.elapsed, 70);
    assert.equal(afterEnd.left, 0);
    assert.equal(afterEnd.pct, 100);
    assert.equal(afterEnd.daysSinceEnd, 10);
    assert.equal(periodProgress({ start: p.start, end: p.end }, '2026-11-01').reviewPct, null);
  });
  it('formats ranges in UTC from the day number', () => {
    assert.equal(formatPeriodRange('2026-10-14', '2026-12-22'), 'Oct 14 – Dec 22, 2026');
    assert.equal(formatPeriodRange('2026-12-23', '2027-01-18'), 'Dec 23, 2026 – Jan 18, 2027');
    assert.equal(formatPeriodRange('bad', '2027-01-18'), 'bad – 2027-01-18');
  });
});

describe('markdown sections', () => {
  it('splits on H2s, keeps H3s inside, ignores fenced headings and merges duplicates', () => {
    const split = splitH2Sections('# Title\n<!-- note -->\n\n## Period\nten weeks\n### Detail\nmore\n\n```\n## Not a heading\n```\n\n## Flow\none\n\n## Flow\ntwo\n');
    assert.deepEqual(split.order, ['Period', 'Flow']);
    assert.equal(split.sections.Period, 'ten weeks\n### Detail\nmore\n\n```\n## Not a heading\n```');
    assert.equal(split.sections.Flow, 'one\n\ntwo');
    assert.deepEqual(split.duplicates, ['Flow']);
    assert.equal(split.preamble, '# Title\n<!-- note -->');
  });
  it('splits the seed Focus into three ranked items and keeps nested lines with their item', () => {
    const focus = splitH2Sections(parseFrontMatter(SEED).body).sections.Focus;
    const items = splitTopLevelItems(focus);
    assert.equal(items.items.length, 3);
    assert.deepEqual(items.items.map((i) => i.marker), ['1.', '2.', '3.']);
    assert.match(items.items[0].text, /^\*\*Convert the job pipeline/);
    assert.match(items.items[2].text, /diploma application/);
    const nested = splitTopLevelItems('Lead text.\n\n- top one\n  - sub a\n  continued\n- top two\n\nTrailing prose.');
    assert.equal(nested.lead, 'Lead text.');
    assert.equal(nested.items.length, 2);
    assert.equal(nested.items[0].text, 'top one\n- sub a\ncontinued');
    assert.equal(nested.trailing, 'Trailing prose.');
  });
  it('parses log entries with —, –, - and (source) separators, newest first', () => {
    const entries = parseLogEntries(P2_LOG);
    assert.deepEqual(
      entries.map((e) => [e.date, e.kind, e.title]),
      [
        ['2026-10-13', 'system', 'closed'],
        ['2026-09-20', 'chat', null],
        ['2026-09-20', 'chat', 'a note from Telegram'],
        ['2026-09-07', 'pulse', 'week of 2026-09-06'],
        ['2026-09-01', 'system', 'opened'],
      ],
    );
    assert.equal(entries[4].body, 'Opened.');
    assert.equal(entries[2].body, 'Adamya: keep the pipeline warm.');
    const p1 = parseLogEntries(P1_LOG);
    assert.equal(p1.length, 2, 'the fenced heading is not an entry');
    assert.match(p1[0].body, /Done vs planned/);
    const loose = parseLogEntries('## 2026-10-01 — something else\ntext\n## Untitled heading\n');
    assert.deepEqual(loose.map((e) => [e.date, e.kind, e.title]), [
      ['2026-10-01', 'other', 'something else'],
      ['', 'other', 'Untitled heading'],
    ]);
  });
  it('retroVerdict prefers the front matter, then the Period-length verdict section', () => {
    const p1 = parseFrontMatter(P1_RETRO);
    assert.equal(retroVerdict(p1.data, splitH2Sections(p1.body).sections), 'right');
    const p2 = parseFrontMatter(P2_RETRO);
    assert.equal(retroVerdict(p2.data, splitH2Sections(p2.body).sections), 'too short');
    assert.equal(retroVerdict({ verdict: 'too-long' }, {}), 'too long');
    assert.equal(retroVerdict({ verdict: '"Unknown"' }, {}), 'unknown');
    assert.equal(retroVerdict({}, { 'Period-length verdict': 'It was right.' }), 'right');
    assert.equal(retroVerdict({ verdict: 'meh' }, { 'What happened': 'x' }), null);
  });
  it('extracts the USER.md bullet block through Scoreboard, excluding the consent preference', () => {
    const block = extractBulletBlock(USER_MD, '**Core North Star (Canonical):**', '**Scoreboard:**');
    assert.ok(block);
    assert.equal(block.endFound, true);
    assert.match(block.text, /primary architect/);
    assert.match(block.text, /Scoreboard/);
    assert.doesNotMatch(block.text, /Consent preference/);
    assert.doesNotMatch(block.text, /Graduation/);
    const noEnd = extractBulletBlock('- **Start:** a\n  cont\n- **Mid:** b\n\nparagraph\n', '**Start:**', '**Missing:**');
    assert.ok(noEnd);
    assert.equal(noEnd.endFound, false);
    assert.equal(noEnd.text, '- **Start:** a\n  cont\n- **Mid:** b');
    assert.equal(extractBulletBlock(USER_MD, '**Nope:**', '**Scoreboard:**'), null);
  });
  it('extracts an H2 section up to the next H1/H2, case-insensitively', () => {
    const anchor = extractH2Section(MEMORY_MD, 'north star anchor');
    assert.match(anchor!, /Anti-Drift/);
    assert.doesNotMatch(anchor!, /Dual Major/);
    const soul = extractH2Section(SOUL_MD, 'Canonical North Star');
    assert.match(soul!, /^> "Ultimate objective/);
    assert.match(soul!, /Execution speed/);
    assert.doesNotMatch(soul!, /Operating Protocol/);
    assert.equal(extractH2Section(SOUL_MD, 'Nothing here'), null);
  });
  it('splits commit subjects on the compass(kind): prefix', () => {
    assert.deepEqual(splitCommitSubject('compass(short): tighten bet 2'), { kind: 'short', subject: 'tighten bet 2' });
    assert.deepEqual(splitCommitSubject('Tidy README'), { kind: null, subject: 'Tidy README' });
  });
});

// ---------- reader ----------

describe('reader', () => {
  let root: string;
  before(() => {
    saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-test-'));
    buildFixture(root);
    process.env.OPENCLAW_COMPASS_DIR = root;
    delete process.env.OPENCLAW_COMPASS_GIT;
    resetGitCacheForTests();
  });
  after(() => {
    restoreEnv();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('compassDir honours OPENCLAW_COMPASS_DIR and falls back to the workspace default', () => {
    assert.equal(compassDir(), root);
    delete process.env.OPENCLAW_COMPASS_DIR;
    assert.equal(compassDir(), DEFAULT_COMPASS_DIR);
    assert.equal(DEFAULT_COMPASS_DIR, '/home/openclaw/.openclaw/workspace/compass');
    process.env.OPENCLAW_COMPASS_DIR = root;
    assert.match(SEED_ID, PERIOD_ID_RE);
    assert.doesNotMatch('2026-10-14', PERIOD_ID_RE);
  });

  it('readShortTermCompass reads the seed with every field and no problems', () => {
    const c = readShortTermCompass(root, '2026-10-20');
    assert.equal(c.available, true);
    assert.equal(c.title, 'Finish Fall 2026 strong and convert the job pipeline into Spring 2027 / new-grad offers');
    assert.deepEqual(c.period, {
      id: SEED_ID,
      title: c.title,
      start: '2026-10-14',
      end: '2026-12-22',
      reviewBy: '2026-12-06',
    });
    assert.equal(c.status, 'active');
    assert.equal(c.version, 1);
    assert.equal(c.updated, '2026-10-14');
    assert.equal(c.opened, null);
    assert.equal(c.closed, null);
    assert.ok(c.mtime && !Number.isNaN(Date.parse(c.mtime)));
    assert.deepEqual(Object.keys(c.sections), [...SHORT_TERM_SECTIONS]);
    assert.match(c.relation, /^- Advances:/);
    assert.match(c.forAgents, /Job postings/);
    assert.match(c.preamble, /^<!-- SEED DRAFTED/);
    assert.match(c.text, /^<!-- SEED/);
    assert.equal(c.path, path.join(root, 'short-term', 'compass.md'));
    // The seed is valid but runs long (7,953 chars), so the only note is the plan's soft size warning.
    assert.deepEqual(c.problems, [`The file is ${SEED.length.toLocaleString('en-US')} characters; keep it under 7,000.`]);
    assert.ok(SEED.length > 7000 && SEED.length < 14_000, `seed is ${SEED.length} chars`);
  });

  it('status follows the New York date', () => {
    assert.equal(readShortTermCompass(root, '2026-10-13').status, 'upcoming');
    assert.equal(readShortTermCompass(root, '2026-12-06').status, 'review-due');
    assert.equal(readShortTermCompass(root, '2026-12-23').status, 'expired');
  });

  it('parseShortTermMarkdown reports problems instead of throwing', () => {
    const missing = parseShortTermMarkdown('---\nkind: short-term\n---\n## Period\nx\n', 'f', '2026-10-20');
    assert.ok(missing.problems.some((p) => p.includes('missing "title"')));
    assert.ok(missing.problems.some((p) => /Missing sections: Relation/.test(p)));
    assert.equal(missing.period, null);
    assert.equal(missing.status, null);

    const bad = parseShortTermMarkdown(
      SEED.replace('period: 2026-10-14--2026-12-22', 'period: 2026-10-14--2026-12-21')
        .replace('review_by: 2026-12-06', 'review_by: 2026-12-30')
        .replace('version: 1', 'version: one')
        .replace('## Not now', '## Later')
        .replace('## Flow\n', '## Flow\n\n## Extra\nstuff\n\n'),
      'f',
      '2026-10-20',
    );
    assert.ok(bad.problems.some((p) => /does not match start--end/.test(p)));
    assert.ok(bad.problems.some((p) => /review_by must fall between/.test(p)));
    assert.ok(bad.problems.some((p) => /version must be a whole number/.test(p)));
    assert.ok(bad.problems.some((p) => /Missing section: Not now/.test(p)));
    assert.ok(bad.problems.some((p) => /Unexpected sections: Later, Extra/.test(p)));
    assert.equal(bad.version, null);
    assert.equal(bad.period?.id, '2026-10-14--2026-12-21', 'the period key is kept as written');

    const order = parseShortTermMarkdown(SEED.replace('## Flow', '## Zz').replace('## Signals', '## Flow').replace('## Zz', '## Signals'), 'f', '2026-10-20');
    assert.ok(order.problems.includes('Sections are out of order.'));

    const idMismatch = parseShortTermMarkdown(SEED, 'f', '2026-10-20', { expectId: P1 });
    assert.ok(idMismatch.problems.some((p) => p.includes(`does not match the file's id ${P1}`)));

    const huge = parseShortTermMarkdown(SEED + '\n' + 'x'.repeat(14_000), 'f', '2026-10-20');
    assert.ok(huge.problems.some((p) => /limit is 14,000/.test(p)));
    const big = parseShortTermMarkdown(SEED + '\n' + 'x'.repeat(1_000), 'f', '2026-10-20');
    assert.ok(big.problems.some((p) => /keep it under 7,000/.test(p)));

    const plain = parseShortTermMarkdown('# Just a title\n\nPeriod text', 'f', '2026-10-20');
    assert.equal(plain.title, 'Just a title');
    assert.equal(plain.available, true);
    assert.ok(plain.problems[0].startsWith('No front matter'));
  });

  it('a missing file is available:false with the path it looked for', () => {
    const c = readShortTermCompass(path.join(root, 'nowhere'), '2026-10-20');
    assert.equal(c.available, false);
    assert.equal(c.path, path.join(root, 'nowhere', 'short-term', 'compass.md'));
    assert.deepEqual(c.sections, {});
  });

  it('listPeriods orders newest first and synthesises the live period without a directory', () => {
    const periods = listPeriods(root, '2026-10-20');
    assert.deepEqual(periods.map((p) => p.id), [SEED_ID, P2, P1]);
    const [cur, p2, p1] = periods;
    assert.equal(cur.state, 'current');
    assert.equal(cur.current, true);
    assert.equal(cur.hasDir, false);
    assert.equal(cur.hasSnapshot, false);
    assert.equal(cur.title, 'Finish Fall 2026 strong and convert the job pipeline into Spring 2027 / new-grad offers');
    assert.equal(cur.weeks, 10);
    assert.equal(cur.finalVersion, 1);
    assert.equal(cur.path, `short-term/periods/${SEED_ID}`);
    assert.equal(p2.state, 'closed');
    assert.equal(p2.closed, '2026-10-13');
    assert.equal(p2.verdict, 'too short');
    assert.equal(p2.logEntries, 5);
    assert.equal(p2.lastLogDate, '2026-10-13');
    assert.equal(p1.state, 'closed');
    assert.equal(p1.verdict, 'right');
    assert.equal(p1.opened, '2026-07-01');
    assert.equal(p1.finalVersion, 3);
    assert.equal(p1.hasLog && p1.hasRetro && p1.hasSnapshot, true);
    assert.equal(p1.logEntries, 2);
    assert.equal(p1.title, 'Summer: ship the Journal and land the internship');
  });

  it('a period directory without a snapshot or close date is unfinished', () => {
    const id = '2026-05-01--2026-06-15';
    write(root, `short-term/periods/${id}/log.md`, `# Log — ${id}\n\n## 2026-05-01 — system — opened\n`);
    try {
      const p = listPeriods(root, '2026-10-20').find((x) => x.id === id)!;
      assert.equal(p.state, 'unfinished');
      assert.equal(p.title, id);
      assert.equal(p.hasLog, true);
      assert.equal(p.hasSnapshot, false);
      assert.equal(listPeriods(root, '2026-10-20').at(-1)?.id, id);
    } finally {
      fs.rmSync(path.join(root, 'short-term', 'periods', id), { recursive: true, force: true });
    }
  });

  it('readDrafts: none, one, two; approved and approvedBy are exposed', () => {
    const one = readDrafts(root, '2026-10-20');
    assert.equal(one.length, 1);
    assert.equal(one[0].id, DRAFT);
    assert.equal(one[0].title, 'Bridge: graduate, decide offers, rest');
    assert.equal(one[0].approved, null);
    assert.equal(one[0].approvedBy, null);
    assert.equal(one[0].start, '2026-12-23');
    assert.equal(one[0].end, '2027-01-18');
    assert.equal(one[0].reviewBy, '2027-01-10');
    assert.deepEqual(one[0].problems, []);
    assert.equal(readDraft(root, '2026-10-20')?.id, DRAFT);

    const second = '2027-01-19--2027-03-15';
    write(root, `short-term/drafts/${second}.md`, compassMd({ id: second, title: 'Spring', reviewBy: '2027-02-28', updated: '2026-12-20', version: 2, approved: '2026-12-20', approvedBy: 'adamya' }));
    write(root, 'short-term/drafts/notes.txt', 'ignored');
    write(root, 'short-term/drafts/.gitkeep', '');
    try {
      const two = readDrafts(root, '2026-10-20');
      assert.deepEqual(two.map((d) => d.id), [DRAFT, second]);
      assert.equal(two[1].approved, '2026-12-20');
      assert.equal(two[1].approvedBy, 'adamya');
      assert.equal(two[1].version, 2);
      assert.equal(readDraft(root, '2026-10-20')?.id, DRAFT);
    } finally {
      fs.rmSync(path.join(root, 'short-term', 'drafts', `${second}.md`));
      fs.rmSync(path.join(root, 'short-term', 'drafts', 'notes.txt'));
    }
    assert.deepEqual(readDrafts(path.join(root, 'nowhere'), '2026-10-20'), []);
    assert.equal(readDraft(path.join(root, 'nowhere'), '2026-10-20'), null);
  });

  it('readPeriod returns the snapshot for a closed period and the live file for the current one', () => {
    const p1 = readPeriod(P1, root, '2026-10-20')!;
    assert.equal(p1.compass?.source, 'snapshot');
    assert.equal(p1.compass?.closed, '2026-08-31');
    assert.equal(p1.compass?.version, 3);
    assert.deepEqual(p1.compass?.problems, []);
    assert.deepEqual(p1.log?.entries.map((e) => e.date), ['2026-07-05', '2026-07-01']);
    assert.equal(p1.retro?.verdict, 'right');
    assert.equal(p1.retro?.closed, '2026-08-31');
    assert.equal(p1.summary.state, 'closed');

    const cur = readPeriod(SEED_ID, root, '2026-10-20')!;
    assert.equal(cur.compass?.source, 'current');
    assert.equal(cur.compass?.period?.id, SEED_ID);
    assert.equal(cur.log, null);
    assert.equal(cur.retro, null);
    assert.equal(cur.summary.current, true);
  });

  it('readPeriod refuses traversal and unknown ids', () => {
    assert.equal(readPeriod('../../etc', root), null);
    assert.equal(readPeriod(`${P1}/../${P2}`, root), null);
    assert.equal(readPeriod('2020-01-01--2020-02-01', root), null);
    assert.equal(readPeriod('', root), null);
  });

  it('readLongTermCompass extracts the three North Star blocks from mirrors shaped like the real files', () => {
    const lt = readLongTermCompass(root);
    assert.equal(lt.available, true);
    assert.deepEqual(lt.files, ['USER.md', 'MEMORY.md', 'SOUL.md']);
    assert.match(lt.parts.user.text!, /primary architect/);
    assert.match(lt.parts.user.text!, /\*\*Scoreboard:\*\*/);
    assert.doesNotMatch(lt.parts.user.text!, /Consent preference/);
    assert.doesNotMatch(lt.parts.user.text!, /Graduation/);
    assert.match(lt.parts.memory.text!, /Anti-Drift/);
    assert.doesNotMatch(lt.parts.memory.text!, /Dual Major/);
    assert.match(lt.parts.soul.text!, /Systemic influence/);
    assert.doesNotMatch(lt.parts.soul.text!, /Operating Protocol/);
    assert.match(lt.text, /^## From USER\.md\n/);
    assert.match(lt.text, /## From MEMORY\.md \(North Star Anchor\)/);
    assert.match(lt.text, /## From SOUL\.md \(Canonical North Star\)/);
    assert.equal(lt.mirroredAtSource, 'mtime', 'no git repo here');
    assert.ok(lt.mirroredAt);
    assert.equal(lt.parts.user.symlink, false);
    assert.equal(lt.parts.user.path, path.join(root, 'long-term', 'USER.md'));
    assert.deepEqual(lt.problems, []);
  });

  it('long-term mirrors: symlinks and missing markers are flagged, nothing mirrored is available:false', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-lt-'));
    try {
      fs.mkdirSync(path.join(other, 'long-term'));
      fs.symlinkSync(path.join(root, 'long-term', 'USER.md'), path.join(other, 'long-term', 'USER.md'));
      fs.writeFileSync(path.join(other, 'long-term', 'MEMORY.md'), '# Memory\n\n## Something else\n- x\n');
      const lt = readLongTermCompass(other);
      assert.equal(lt.available, true);
      assert.deepEqual(lt.files, ['USER.md', 'MEMORY.md']);
      assert.equal(lt.parts.user.symlink, true);
      assert.equal(lt.parts.user.markerFound, true);
      assert.equal(lt.parts.memory.markerFound, false);
      assert.equal(lt.parts.memory.text, null);
      assert.equal(lt.parts.soul.exists, false);
      assert.ok(lt.problems.some((p) => /USER\.md is a symlink/.test(p)));
      assert.ok(lt.problems.some((p) => /MEMORY\.md: "North Star Anchor" was not found/.test(p)));
      assert.doesNotMatch(lt.text, /From MEMORY/);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
    const none = readLongTermCompass(path.join(root, 'nowhere'));
    assert.equal(none.available, false);
    assert.equal(none.text, '');
    assert.equal(none.mirroredAt, null);
    assert.deepEqual(none.files, []);
  });

  it('readOverview bundles everything and reports a plain directory as not a repo', () => {
    const o = readOverview(root, '2026-10-20');
    assert.equal(o.today, '2026-10-20');
    assert.equal(o.dir, root);
    assert.equal(o.available, true);
    assert.equal(o.shortTerm.period?.id, SEED_ID);
    assert.equal(o.periods.length, 3);
    assert.equal(o.drafts.length, 1);
    assert.equal(o.longTerm.available, true);
    assert.equal(o.repo.isRepo, false);
    assert.equal(typeof o.repo.error, 'string');
    assert.ok(!Number.isNaN(Date.parse(o.generatedAt)));
  });

  it('a missing directory degrades to empty states, never a throw', () => {
    const gone = path.join(root, 'nonexistent');
    const o = readOverview(gone, '2026-10-20');
    assert.equal(o.available, false);
    assert.equal(o.shortTerm.available, false);
    assert.equal(o.longTerm.available, false);
    assert.deepEqual(o.periods, []);
    assert.deepEqual(o.drafts, []);
    assert.equal(o.repo.isRepo, false);
    assert.match(o.repo.error!, /does not exist/);
  });

  it('API: overview, period and 404 matrix', async () => {
    const overview = await call();
    assert.equal(overview.status, 200);
    assert.equal(overview.body.success, true);
    assert.equal(overview.body.data.shortTerm.period.id, SEED_ID);
    assert.equal(overview.body.data.periods.length, 3);
    assert.equal(overview.body.data.drafts[0].id, DRAFT);
    assert.match(overview.body.data.today, /^\d{4}-\d{2}-\d{2}$/);

    const p1 = await call(`/periods/${P1}`);
    assert.equal(p1.status, 200);
    assert.equal(p1.body.data.compass.source, 'snapshot');
    const cur = await call(`/periods/${SEED_ID}`);
    assert.equal(cur.body.data.compass.source, 'current');

    for (const p of ['/periods/2020-01-01--2020-02-01', '/periods/..%2F..%2Fetc', '/periods/x', '/nope', '/history/zzz', '/history/abc', `/periods/${P1}/log`]) {
      const r = await call(p);
      assert.equal(r.status, 404, p);
      assert.equal(r.body.success, false);
    }

    const history = await call('/history?scope=weird&limit=999');
    assert.equal(history.status, 200, 'no repo is still a 200');
    assert.deepEqual(history.body.data.commits, []);
    assert.equal(history.body.data.scope, 'short');
    assert.equal(history.body.data.limit, 30, 'an out-of-range limit falls back to the default, like the media route');
    assert.equal(typeof history.body.data.error, 'string');
  });

  it('API: a missing directory answers 200 with available:false', async () => {
    process.env.OPENCLAW_COMPASS_DIR = path.join(root, 'nonexistent');
    try {
      const r = await call();
      assert.equal(r.status, 200);
      assert.equal(r.body.data.available, false);
      assert.equal(r.body.data.shortTerm.available, false);
      const h = await call('/history');
      assert.equal(h.status, 200);
      assert.match(h.body.data.error, /does not exist/);
      assert.equal((await call(`/periods/${P1}`)).status, 404);
    } finally {
      process.env.OPENCLAW_COMPASS_DIR = root;
    }
  });
});

// ---------- git ----------

describe('git history', { skip: hasGit ? false : 'git is not installed' }, () => {
  let root: string;
  let shas: Record<string, string>;
  before(() => {
    saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-git-'));
    shas = buildGitFixture(root);
    process.env.OPENCLAW_COMPASS_DIR = root;
    delete process.env.OPENCLAW_COMPASS_GIT;
    resetGitCacheForTests();
  });
  after(() => {
    restoreEnv();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('gitAvailable and isCompassRepo', () => {
    assert.equal(gitAvailable(), true);
    const check = isCompassRepo(root);
    assert.equal(check.isRepo, true);
    assert.equal(check.error, null);
    assert.equal(fs.realpathSync(check.toplevel!), fs.realpathSync(root));
  });

  it('listCommits: scopes, limits, author and subject kinds, fixed dates', () => {
    const all = listCommits(root, { scope: 'all', limit: 200 });
    assert.equal(all.error, null);
    assert.equal(all.commits.length, 11);
    assert.equal(all.commits[0].sha, shas.big);
    assert.equal(all.commits.at(-1)?.sha, shas.repo);
    assert.equal(all.commits.at(-1)?.date, '2026-07-01T09:00:00-04:00');
    assert.equal(all.commits[0].shortSha, shas.big.slice(0, 7));

    const byKey = Object.fromEntries(all.commits.map((c) => [c.sha, c]));
    assert.equal(byKey[shas.repo].authorKind, 'adamya');
    assert.equal(byKey[shas.repo].kind, 'repo');
    assert.equal(byKey[shas.pulse].authorKind, 'openclaw');
    assert.equal(byKey[shas.pulse].kind, 'pulse');
    assert.equal(byKey[shas.mirror].authorKind, 'compass-sync');
    assert.equal(byKey[shas.mirror].kind, 'long');
    assert.equal(byKey[shas.open1].kind, 'period');
    assert.equal(byKey[shas.draft].kind, 'draft');
    assert.equal(byKey[shas.other].authorKind, 'other');
    assert.equal(byKey[shas.other].kind, 'other');
    assert.equal(byKey[shas.other].author, 'Other Person');

    const short = listCommits(root, { scope: 'short', limit: 200 }).commits;
    assert.equal(short.length, 8);
    assert.ok(!short.some((c) => c.sha === shas.repo || c.sha === shas.mirror || c.sha === shas.other));
    const long = listCommits(root, { scope: 'long', limit: 200 }).commits;
    assert.deepEqual(long.map((c) => c.sha), [shas.mirror, shas.repo]);
    assert.equal(listCommits(root, { limit: 3 }).commits.length, 3);
    assert.equal(listCommits(root, { limit: 0 }).commits.length, 1, 'limit clamps to 1');
    assert.equal(listCommits(root, { limit: 999 }).commits.length, 11, 'limit clamps to 200');
  });

  it('authorKind and commitKind helpers', () => {
    assert.equal(authorKind('Adamya Singh', 'x@y'), 'adamya');
    assert.equal(authorKind('OpenClaw', 'openclaw@ubuntu-laptop.local'), 'openclaw');
    assert.equal(authorKind('compass-sync', 'compass-sync@ubuntu-laptop.local'), 'compass-sync');
    assert.equal(authorKind('Someone', 'a@b'), 'other');
    assert.equal(commitKind('compass(short): edit'), 'short');
    assert.equal(commitKind('compass(period): open x'), 'period');
    assert.equal(commitKind('compass(weird): x'), 'other');
    assert.equal(commitKind('fix: x'), 'other');
  });

  it('showCommit returns the unified diff, caps it at 200 KB and refuses bad shas', () => {
    const pulse = showCommit(root, shas.pulse)!;
    assert.equal(pulse.sha, shas.pulse);
    assert.equal(pulse.subject, 'compass(pulse): week of 2026-07-05');
    assert.equal(pulse.kind, 'pulse');
    assert.deepEqual(pulse.files, [`short-term/periods/${P1}/log.md`]);
    assert.match(pulse.diff, /^diff --git/);
    assert.match(pulse.diff, /\n\+## 2026-07-05 — pulse — week of 2026-07-05/);
    assert.ok(pulse.additions >= 5);
    assert.equal(pulse.deletions, 0);
    assert.equal(pulse.truncated, false);
    assert.equal(pulse.body, '');

    const big = showCommit(root, shas.big)!;
    assert.equal(big.truncated, true);
    assert.equal(big.diff.length, 200 * 1024);
    assert.deepEqual(big.files, ['short-term/big.txt']);

    assert.equal(showCommit(root, shas.pulse.slice(0, 7))?.sha, shas.pulse, 'a short sha resolves');
    assert.equal(showCommit(root, 'zzzz'), null);
    assert.equal(showCommit(root, 'deadbeef'), null);
    assert.equal(showCommit(root, 'HEAD'), null);
    assert.equal(showCommit(root, shas.pulse + '; rm -rf /'), null);
  });

  it('repoInfo reports branch, head and a remote without userinfo; mirroredAt comes from git', () => {
    const info = repoInfo(root);
    assert.equal(info.gitAvailable, true);
    assert.equal(info.isRepo, true);
    assert.equal(info.branch, 'main');
    assert.equal(info.head?.sha, shas.big);
    assert.equal(info.remote, null);
    git(root, ['remote', 'add', 'origin', 'git@github.com-compass:adamya-singh/compass.git']);
    assert.equal(repoInfo(root).remote, 'github.com-compass:adamya-singh/compass.git');
    assert.equal(stripUserinfo('https://user:pw@github.com/a/b.git'), 'https://github.com/a/b.git');
    assert.equal(stripUserinfo('ssh://git@host.example/x/y'), 'ssh://host.example/x/y');
    assert.equal(stripUserinfo('/srv/git/compass.git'), '/srv/git/compass.git');

    const lt = readLongTermCompass(root);
    assert.equal(lt.mirroredAtSource, 'git');
    assert.equal(lt.mirroredAt, '2026-07-12T18:00:00-04:00');
  });

  it('listHistory and the API history routes', async () => {
    const h = listHistory(root, 'short', 5);
    assert.equal(h.commits.length, 5);
    assert.equal(h.error, null);
    assert.equal(h.limit, 5);
    const api = await call('/history?scope=long');
    assert.equal(api.status, 200);
    assert.deepEqual(api.body.data.commits.map((c: { sha: string }) => c.sha), [shas.mirror, shas.repo]);
    const detail = await call(`/history/${shas.pulse}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.sha, shas.pulse);
    assert.match(detail.body.data.diff, /diff --git/);
    assert.equal((await call(`/history/${shas.pulse.toUpperCase()}`)).status, 200, 'sha case does not matter');
    assert.equal((await call('/history/0000000')).status, 404);
    const overview = await call();
    assert.equal(overview.body.data.repo.head.sha, shas.big);
    assert.equal(overview.body.data.longTerm.mirroredAtSource, 'git');
  });

  it('a compass/ folder inside another repo is not treated as that repo', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-parent-'));
    try {
      git(parent, ['init', '-q', '-b', 'main']);
      write(parent, 'AGENTS.md', '# Agents\n');
      commit(parent, 'adamya', 'workspace commit', '2026-09-20T10:00:00-04:00');
      const nested = path.join(parent, 'compass');
      write(nested, 'short-term/compass.md', SEED);
      const check = isCompassRepo(nested);
      assert.equal(check.isRepo, false);
      assert.match(check.error!, /not its own git repository/);
      const history = listHistory(nested, 'all');
      assert.deepEqual(history.commits, []);
      assert.match(history.error!, /not its own git repository/);
      const info = repoInfo(nested);
      assert.equal(info.isRepo, false);
      assert.equal(info.head, null);
      assert.equal(readShortTermCompass(nested, '2026-10-20').available, true, 'the files still read');
      assert.equal(readLongTermCompass(nested).available, false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('an initialised repo without commits is a repo with an empty history', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-empty-'));
    try {
      git(empty, ['init', '-q', '-b', 'main']);
      const h = listHistory(empty, 'all');
      assert.deepEqual(h.commits, []);
      assert.equal(h.error, null);
      const info = repoInfo(empty);
      assert.equal(info.isRepo, true);
      assert.equal(info.branch, 'main');
      assert.equal(info.head, null);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('a missing git binary degrades to errors, not throws', async () => {
    process.env.OPENCLAW_COMPASS_GIT = '/nonexistent/git';
    resetGitCacheForTests();
    try {
      assert.equal(gitAvailable(), false);
      const h = listHistory(root, 'short');
      assert.deepEqual(h.commits, []);
      assert.match(h.error!, /git is not installed/);
      const info = repoInfo(root);
      assert.equal(info.gitAvailable, false);
      assert.equal(info.isRepo, false);
      assert.equal(readLongTermCompass(root).mirroredAtSource, 'mtime');
      const api = await call('/history');
      assert.equal(api.status, 200);
      assert.match(api.body.data.error, /git is not installed/);
      assert.equal((await call(`/history/${shas.pulse}`)).status, 404);
      const overview = await call();
      assert.equal(overview.status, 200);
      assert.equal(overview.body.data.repo.gitAvailable, false);
      assert.equal(overview.body.data.shortTerm.available, true);
    } finally {
      delete process.env.OPENCLAW_COMPASS_GIT;
      resetGitCacheForTests();
    }
    assert.equal(gitAvailable(), true);
  });
});
