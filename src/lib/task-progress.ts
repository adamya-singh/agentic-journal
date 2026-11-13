// What was done for a task, kept in the task's own notes under "## Progress", so the brief, the workspace and
// the next OpenClaw session all read it. Written by OpenClaw through POST /api/tasks/progress when it acts for a
// task (sends an email, submits something, learns what comes next).
// Shape of the section, which parseNotes (task-brief.ts) reads as the brief's "Progress" section:
//   ## Progress
//   - **Next:** what comes next
//   - **Waiting on:** who or what, and since when
//   - Nov 13: what was done
// Pure: no filesystem, so the route and the tests share it.

export interface ProgressEntry {
  did: string;                 // what was done, one line
  next?: string;               // what comes next; omitted keeps the last one, empty clears it
  waitingOn?: string;          // who or what the task waits on; omitted keeps the last one, empty clears it
}

export const PROGRESS_HEADING = '## Progress';
export const PROGRESS_LINE_MAX = 600;
const NOTES_MAX = 20000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, PROGRESS_LINE_MAX);
const fact = (key: string) => new RegExp(`^- \\*\\*${key}:\\*\\*\\s*(.*)$`, 'i');

/**
 * The notes with one more thing recorded under "## Progress": the entry is added to the end of the log with its
 * day, and Next / Waiting on are the latest ones said. Everything else in the notes stays as it is. When the notes
 * would pass their limit, the oldest log lines go first.
 */
export function recordProgress(notes: string | undefined, entry: ProgressEntry, now: Date): string {
  const lines = (notes ?? '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === PROGRESS_HEADING.toLowerCase());
  let end = lines.length;
  if (start >= 0) {
    const after = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
    if (after >= 0) end = after;
  }
  const before = start >= 0 ? lines.slice(0, start) : lines;
  const rest = start >= 0 ? lines.slice(end) : [];
  let next = '', waitingOn = '';
  const log: string[] = [];
  for (const line of start >= 0 ? lines.slice(start + 1, end) : []) {
    const isNext = fact('Next').exec(line.trim());
    const isWaiting = fact('Waiting on').exec(line.trim());
    if (isNext) next = isNext[1];
    else if (isWaiting) waitingOn = isWaiting[1];
    else if (line.trim() !== '') log.push(line.trimEnd());
  }
  if (entry.next !== undefined) next = oneLine(entry.next);
  if (entry.waitingOn !== undefined) waitingOn = oneLine(entry.waitingOn);
  log.push(`- ${MONTHS[now.getMonth()]} ${now.getDate()}: ${oneLine(entry.did)}`);

  const build = () => {
    const section = [PROGRESS_HEADING, ...(next ? [`- **Next:** ${next}`] : []), ...(waitingOn ? [`- **Waiting on:** ${waitingOn}`] : []), ...log];
    const head = before.join('\n').trimEnd();
    const tail = rest.join('\n').trim();
    return [head, section.join('\n'), tail].filter((part) => part !== '').join('\n\n');
  };
  let out = build();
  while (out.length > NOTES_MAX && log.length > 1) { log.shift(); out = build(); }
  return out;
}
