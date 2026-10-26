#!/usr/bin/env node
// OA previews from the command line, for OpenClaw (skill: agentic-journal-oa-preview).
// Writes go straight to the Journal's files, so this works while the web server is down.
//   node scripts/oa-preview.ts pending                      (open OAs with a link and no preview yet)
//   node scripts/oa-preview.ts save --listing <id> --file page.md --summary "…" [--summary "…"] [--summary-file lines.json]
//                                   [--status saved|blocked] [--attach shot-1.png] [--attach prompt.pdf] …
//   node scripts/oa-preview.ts fail --listing <id> --error "…"
//   node scripts/oa-preview.ts wake                         (ask OpenClaw now for any OA still due a preview)
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

// OpenClaw runs this from its own workspace, and the data dir otherwise follows the working directory.
process.env.BACKEND_DATA_DIR ||= path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'backend', 'data');
register('./test-alias-loader.mjs', import.meta.url);
const preview = await import('../src/app/api/jobs/assessment-preview-utils.ts');

const [command = 'help', ...args] = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const all = (name: string) => args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []));
const need = (name: string) => { const v = opt(name); if (!v) throw new Error(`${command} needs --${name}`); return v; };
const out = (data: unknown) => console.log(JSON.stringify({ success: true, data }, null, 2));

try {
  if (command === 'pending') {
    out({ previews: preview.listPendingPreviews() });
  } else if (command === 'save') {
    const status = opt('status') ?? 'saved';
    if (status !== 'saved' && status !== 'blocked') throw new Error('--status is saved or blocked');
    const summaryFile = opt('summary-file');
    const fromFile = summaryFile ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : [];
    if (!Array.isArray(fromFile) || fromFile.some((line) => typeof line !== 'string')) throw new Error('--summary-file must hold a JSON array of strings');
    const attachments = all('attach').map((file) => ({ name: path.basename(file), data: fs.readFileSync(file) }));
    out(await preview.saveAssessmentPreview({
      listingId: need('listing'), status, body: fs.readFileSync(need('file'), 'utf8'),
      summary: [...fromFile, ...all('summary')], attachments,
    }));
  } else if (command === 'fail') {
    out(await preview.failAssessmentPreview(need('listing'), need('error')));
  } else if (command === 'wake') {
    out({ requested: await preview.wakeAssessmentPreviewsIfDue({ force: true }) });
  } else {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  }
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
