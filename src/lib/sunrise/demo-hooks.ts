// Stand-in hooks for looking at Sunrise where OpenClaw is not installed (SUNRISE_DEMO_HOOKS=1, never in production).
// Each is made from the task's own rule-built brief, so the names and dates are real; only the "started work" is a
// placeholder that says so. Real hooks come from OpenClaw's fill (brief-agent.ts).
import type {TaskBrief} from '@/lib/task-brief'
import type {Part} from '@/lib/shapes/catalog'
import {type TaskHook, iconForKind} from '@/lib/shapes/hook'

const plain = (title: string) => title.replace(/^\s*\[[^\]]+\]\s*/, '').trim() || title.trim()
const daysLeft = (brief: TaskBrief) => brief.when.due === null ? null : Math.max(0, Math.round((Date.parse(brief.when.due) - Date.parse(brief.generatedAt)) / 864e5))

export function demoHook(brief: TaskBrief): TaskHook {
  const title = plain(brief.title).slice(0, 56)
  const days = daysLeft(brief)
  const steps = brief.steps.filter(step => !step.done).map(step => step.text.slice(0, 70))
  const base = {icon: iconForKind(brief.kind), did: ['Read what the Journal has on it', 'Set up a first step (demo)'], what: brief.stakes ?? `${title}.${brief.when.due === null ? '' : ` Due ${brief.when.day}.`}`}
  const work = (format: NonNullable<TaskHook['work']>['format'], body: string): TaskHook['work'] =>
    ({format, title, body: `${body}\n\n_(Demo text. OpenClaw's real started work appears here once it has filled this task.)_`})
  const rows = (items: string[]): Part => ({kind: 'rows', check: true, items: items.map((text, index) => ({text, ...index === 0 ? {done: true, detail: 'set up'} : {}}))})
  switch (brief.kind) {
    case 'exam':
      return {
        ...base, shape: 'orb', kind: 'exam', name: `Study for ${title}`.slice(0, 60), next: 'Start practice problem 1',
        say: [`Study for ${title}.`.slice(0, 60), 'The first practice problem is set up.'],
        parts: [{kind: 'value', value: String(days ?? '?'), unit: days === 1 ? 'day left' : 'days left'}, {kind: 'steps', items: ['Topics', 'Practice', 'Review'], at: 1}],
        work: work('checklist', '- [x] List the topics it covers\n- [ ] Practice problem 1\n- [ ] Practice problem 2\n- [ ] Review what you missed'),
      }
    case 'presentation':
      return {
        ...base, shape: 'band', kind: 'talk', name: title, next: 'Write the opening line',
        say: [`Get ${title} ready.`.slice(0, 60), 'It is outlined. The opening line is yours.'],
        parts: [{kind: 'steps', items: ['Outline', 'Slides', 'Rehearse', 'Present'], at: 1}],
        work: work('outline', `# ${title}\n\n1. Opening: \n2. The main point\n3. One example\n4. Close`),
      }
    case 'reading':
      return {
        ...base, shape: 'note', kind: 'reading', name: title, next: 'Start reading, notes open',
        say: [`Read: ${title}.`.slice(0, 60), 'A notes page is open beside it.'],
        parts: [{kind: 'quote', text: title, by: 'to read'}, {kind: 'rows', items: [{text: 'What is the core claim?'}, {text: 'What would you try yourself?'}]}],
        work: work('text', `# Notes on ${title}\n\n- The core claim:\n- What I would try:`),
      }
    case 'assessment':
    case 'build':
      return {
        ...base, shape: 'tile', kind: brief.kind === 'build' ? 'build' : 'assessment', name: title, next: steps[0] ?? 'Do the first step',
        say: [`Start ${title}.`.slice(0, 60), 'The first step is laid out.'],
        parts: [{kind: 'code', name: 'first step', text: `# ${title}\n# 1. ${steps[0] ?? 'set up'}\n`}, {kind: 'chips', items: [brief.when.day, brief.group].filter(Boolean)}],
        work: work('checklist', (steps.length > 0 ? steps : ['Set up', 'First pass', 'Check and submit']).map(step => `- [ ] ${step}`).join('\n')),
      }
    case 'errand':
    case 'plan':
      return {
        ...base, shape: 'pill', kind: brief.kind, name: title, next: steps[0] ?? 'Do it now, it is short',
        say: [`${title}.`.slice(0, 60), 'It is one short step.'], parts: [{kind: 'line', text: brief.when.due === null ? 'No date on it.' : `Due ${brief.when.day}.`}],
        work: null,
      }
    default: {
      const items = steps.length >= 2 ? steps.slice(0, 4) : ['Read the instructions', 'Do the first part', 'Finish and check', 'Submit']
      return {
        ...base, shape: 'list', kind: brief.kind === 'assignment' ? 'assignment' : brief.kind === 'catch-up' ? 'catch-up' : 'task', name: title, next: '',
        say: [`Start ${title}.`.slice(0, 60), 'The first step is done and the next is set up.'],
        parts: [rows(items), ...days === null ? [] : [{kind: 'ring', value: 0.25, label: `${days}d`} satisfies Part]],
        work: work('checklist', items.map((item, index) => `- [${index === 0 ? 'x' : ' '}] ${item}`).join('\n')),
      }
    }
  }
}
