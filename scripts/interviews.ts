#!/usr/bin/env node
// The Interviews casebook from the command line, for OpenClaw and one-off jobs.
// Writes go straight to the Journal's files (interviews/index.json + notes), so
// this works while the web server is down.
//   node scripts/interviews.ts list
//   node scripts/interviews.ts show --process <id|listing:ID>               (rounds with their ids, notes, people)
//   node scripts/interviews.ts note --process <id|listing:ID> --title "…" --kind prep --round before --file notes.md [--author openclaw]
//   node scripts/interviews.ts round --process <id|listing:ID> --id <roundId> [--name …] [--at ISO] [--time "1:00 PM"] [--duration "15 min"] [--people "A,B"]
//   node scripts/interviews.ts person --process <id|listing:ID> --name "…" [--role …] [--email …]
//   node scripts/interviews.ts domain --company "…" --domain example.com [--if-missing true]   (also fetches the logo)
//   node scripts/interviews.ts missing-domains                               (companies with no logo domain yet)
//   node scripts/interviews.ts logos [--force true]
//   node scripts/interviews.ts import-2025-26 [--from ~/.openclaw/workspace/interviews]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

register('./test-alias-loader.mjs', import.meta.url);
const store = await import('../src/lib/interviews/store.ts');
const actions = await import('../src/lib/interviews/actions.ts');
const logos = await import('../src/lib/interviews/logos.ts');
const { talkSummary } = await import('../src/lib/interviews/talk.ts');

const [command = 'help', ...args] = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const need = (name: string) => { const v = opt(name); if (!v) throw new Error(`${command} needs --${name}`); return v; };
const out = (data: unknown) => console.log(JSON.stringify({ success: true, data }, null, 2));

async function listingSource() {
  const { readJobListings } = await import('../src/app/api/jobs/job-store-utils.ts');
  const { readJobApplicationsStore } = await import('../src/app/api/jobs/application-store-utils.ts');
  return { listings: readJobListings().listings, applications: readJobApplicationsStore().applications };
}

async function importSeason(from: string) {
  const data = await import('./interviews-2025-26.ts');
  return store.mutateInterviews((index) => {
    const report: string[] = [];
    for (const [company, domain] of Object.entries(data.DOMAINS)) index.domains[company] ??= domain;
    for (const src of data.PROCESSES) {
      const id = `2025-26/${src.slug}`;
      if (index.processes.some((p) => p.id === id)) { report.push(`${id}: already imported, skipped`); continue; }
      const now = new Date().toISOString();
      const process = {
        id, season: '2025-26', company: src.company, role: src.role, term: src.term, location: src.location,
        outcome: src.outcome, people: src.people, rounds: src.rounds,
        events: src.events.map(([at, kind, label]) => ({ at, kind, label })),
        notes: [] as import('../src/lib/interviews/types.ts').StoredNote[], flags: src.flags, createdAt: now, updatedAt: now,
      };
      for (const n of src.notes) {
        const source = path.join(from, src.folder, n.file);
        const body = fs.readFileSync(source);
        const file = path.basename(n.file).replace(/[^A-Za-z0-9._-]+/g, '_');
        const bytes = store.writeNoteFile(process, file, body);
        const talk = n.talkYou ? talkSummary(body.toString('utf8'), n.talkYou) : undefined;
        process.notes.push({
          id: `${src.slug}:${path.parse(file).name}`, title: n.title, kind: n.kind, round: n.round, date: n.date,
          author: n.author ?? 'import', file, bytes, importedFrom: `interviews/${src.folder}/${n.file}`, ...(talk ? { talk } : {}),
        });
      }
      index.processes.push(process);
      report.push(`${id}: ${process.notes.length} notes, ${process.rounds.length} rounds`);
    }
    data.QUESTIONS.forEach(([type, text, slug, round, answer], i) => {
      const qid = `2025-26:q${i + 1}`;
      if (!index.questions.some((q) => q.id === qid)) index.questions.push({ id: qid, processId: `2025-26/${slug}`, round, type, text, ...(answer ? { answer } : {}) });
    });
    data.LESSONS.forEach(([slug, date, text, source], i) => {
      const lid = `2025-26:l${i + 1}`;
      if (!index.lessons.some((l) => l.id === lid)) index.lessons.push({ id: lid, processId: `2025-26/${slug}`, date, text, source });
    });
    return report;
  });
}

try {
  if (command === 'list') {
    const index = store.readInterviews();
    out(index.processes.map((p) => ({ id: p.id, listingId: p.listingId, company: p.company, role: p.role, notes: p.notes.length, rounds: p.rounds.length })));
  } else if (command === 'show') {
    const want = need('process');
    const { buildCasebook } = await import('../src/lib/interviews/view.ts');
    const { readExtras } = await import('../src/app/api/jobs/overview/store.ts');
    const view = buildCasebook({ index: store.readInterviews(), ...(await listingSource()), milestones: readExtras().milestones });
    const p = view.processes.find((x) => x.key === want || `listing:${x.listingId}` === want);
    if (!p) throw new Error(`No casebook process for ${want}. A posting appears once the employer replies, or after the first note is saved for it.`);
    out({ key: p.key, company: p.company, role: p.role, season: p.season, outcome: p.outcome.label,
      rounds: p.rounds.map((r) => ({ id: r.id, name: r.name, kind: r.kind, state: r.state, at: r.at })),
      notes: p.notes.map((n) => ({ id: n.id, title: n.title, round: n.round, author: n.author })), people: p.people });
  } else if (command === 'note') {
    const body = fs.readFileSync(need('file'), 'utf8');
    const source = await listingSource();
    const kind = (opt('kind') ?? 'notes') as import('../src/lib/interviews/types.ts').NoteKind;
    if (!actions.NOTE_KINDS.includes(kind)) throw new Error(`--kind must be one of ${actions.NOTE_KINDS.join(', ')}`);
    const note = await store.mutateInterviews((index) => actions.saveNote(index, {
      key: need('process'), noteId: opt('note-id'), title: opt('title'), kind, round: opt('round') ?? 'before', body,
      author: (opt('author') ?? 'openclaw') as 'openclaw', date: opt('date'),
    }, source));
    out({ id: note.id, file: note.file, bytes: note.bytes });
  } else if (command === 'round') {
    const source = await listingSource();
    const round = await store.mutateInterviews((index) => actions.setRound(index, need('process'), {
      id: need('id'), name: opt('name'), at: opt('at'), time: opt('time'), duration: opt('duration'), format: opt('format'), note: opt('note'),
      people: opt('people')?.split(',').map((s) => s.trim()).filter(Boolean),
    }, source));
    out(round);
  } else if (command === 'person') {
    const source = await listingSource();
    await store.mutateInterviews((index) => actions.addPerson(index, need('process'), { name: need('name'), role: opt('role'), email: opt('email') }, source));
    out({ ok: true });
  } else if (command === 'domain') {
    const known = store.readInterviews().domains[need('company').trim().toLowerCase()];
    if (known && opt('if-missing') === 'true') { out({ domain: known, skipped: 'already set' }); process.exit(0); }
    const domain = await store.mutateInterviews((index) => actions.setDomain(index, need('company'), need('domain')));
    const logo = await logos.ensureLogo(domain, true);
    out({ domain, logo: logo ? path.basename(logo.file) : 'not found' });
  } else if (command === 'missing-domains') {
    const index = store.readInterviews();
    const { buildCasebook } = await import('../src/lib/interviews/view.ts');
    const { readExtras } = await import('../src/app/api/jobs/overview/store.ts');
    const source = await listingSource();
    const view = buildCasebook({ index, ...source, milestones: readExtras().milestones });
    out([...new Set(view.processes.filter((p) => !p.domain).map((p) => p.company))]);
  } else if (command === 'logos') {
    const index = store.readInterviews();
    const results: Record<string, string> = {};
    for (const domain of [...new Set(Object.values(index.domains))]) {
      const logo = await logos.ensureLogo(domain, opt('force') === 'true');
      results[domain] = logo ? path.basename(logo.file) : 'not found';
    }
    out(results);
  } else if (command === 'import-2025-26') {
    const from = (opt('from') ?? '~/.openclaw/workspace/interviews').replace(/^~/, os.homedir());
    out(await importSeason(from));
  } else {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  }
} catch (e) {
  console.error(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
