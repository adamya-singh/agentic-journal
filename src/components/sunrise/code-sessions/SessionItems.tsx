'use client';

// The items of a coding session's turns as the chat pane draws them: what he said, what the agent said (markdown,
// as it streams), and the steps of the work as one-line rows that open (a command and its output, a file and its
// diff, a tool call's input and result, a search, a thought), the agent's plan as a checklist, notices, and the
// questions it asks him as multiple-choice cards (answered here, they show what he chose).
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AGENT_LABEL, answersComplete, answerText,
  type AgentKind, type AgentQuestion, type FileEdit, type QuestionAnswer, type QuestionAnswers, type RateLimitSummary, type SessionItem, type SessionTurn,
} from '@/lib/code-agents/protocol';
import {
  commandOutcome, diffCounts, failureText, formatDuration, isInternalHref, parseDiff, prettyJson, replyEntries, shortPath, stepsSummary, toolInputLine, turnBlocks,
  type QuestionReplies, type TurnBlock,
} from '@/lib/code-sessions-ui';

const DIFF_LINES_MAX = 1500;

const away = { target: '_blank', rel: 'noopener noreferrer' } as const;
/**
 * Links open in a new tab unless they are the Journal's own pages. Images are not loaded: an agent's reply could
 * otherwise send what it read to any server through an image's address (Codex's own network block does not reach
 * the browser). An image shows as a link with its alt text, to open by hand.
 */
const mdLink = {
  a: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} {...(isInternalHref(href) ? {} : away)} />,
  img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const url = typeof src === 'string' ? src : '';
    const words = alt?.trim() ? `Image: ${alt.trim()}` : url ? `Image: ${url}` : 'An image';
    return url ? <a href={url} {...away} title={url}>{words}</a> : <span>{words}</span>;
  },
};

/** What the agent said, as markdown. Drawn again only when its text grew. */
export const AgentText = React.memo(function AgentText({ text, final }: { text: string; final: boolean }) {
  return <div className={`srk-m agent ${final ? 'final' : 'mid'}`}><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdLink}>{text}</ReactMarkdown></div>;
});

type Item<K extends SessionItem['kind']> = Extract<SessionItem, { kind: K }>;

// ---- Questions.

const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

/** What the log's question cards need from the pane: his answers so far, what can be answered, and how. */
export interface QuestionContextValue {
  replies: QuestionReplies;
  /** Questions asked without waiting whose answer is on its way. */
  replying: Set<string>;
  /** Question items that wait on the card above the composer (an ask the agent holds its turn for). */
  waiting: Set<string>;
  /** A turn runs: an answer goes into it. */
  working: boolean;
  reply: (itemId: string, entries: { questionId: string; question: string; answer: string }[]) => void;
}
export const QuestionContext = React.createContext<QuestionContextValue | null>(null);

/** A question's words: markdown, as the agent writes them (a long question carries its context). */
function QuestionText({ text }: { text: string }) {
  return <div className="srk-qtext"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdLink}>{text}</ReactMarkdown></div>;
}

/** One question: its options to choose from (one, or several), and a box for his own answer when it takes one. */
function QuestionField({ q, n, count, answer, onChange, onEnter }: { q: AgentQuestion; n: number; count: number; answer: QuestionAnswer | undefined; onChange: (a: QuestionAnswer) => void; onEnter: () => void }) {
  const a = answer ?? { picked: [] };
  const pick = (label: string) => {
    if (q.multi) onChange({ ...a, picked: a.picked.includes(label) ? a.picked.filter((l) => l !== label) : [...a.picked, label] });
    // One choice: choosing an option takes the place of what he wrote.
    else onChange({ picked: a.picked[0] === label ? [] : [label] });
  };
  const write = (text: string) => onChange(q.multi ? { ...a, other: text } : { picked: text.trim() ? [] : a.picked, other: text });
  const writes = q.other || q.options.length === 0;
  return (
    <fieldset className="srk-q">
      {(count > 1 || q.header) && (
        <legend>{count > 1 && <span className="n">{n + 1} of {count}</span>}{q.header && <small>{q.header}</small>}</legend>
      )}
      <QuestionText text={q.question} />
      {q.multi && q.options.length > 0 && <span className="hint">Choose any that apply.</span>}
      {q.options.length > 0 && (
        <div className="opts" role={q.multi ? 'group' : 'radiogroup'} aria-label={q.header || q.question}>
          {q.options.map((o) => {
            const on = a.picked.includes(o.label);
            return (
              <button key={o.label} type="button" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} className={`opt${on ? ' on' : ''}`} onClick={() => pick(o.label)}>
                <i aria-hidden="true" className={q.multi ? 'box' : 'dot'} />
                <span className="w"><b>{o.label}</b>{o.description && o.description.trim() !== o.label.trim() && <small>{o.description}</small>}</span>
              </button>
            );
          })}
        </div>
      )}
      {writes && (
        <input
          className={`other${a.other?.trim() ? ' on' : ''}`}
          type={q.secret ? 'password' : 'text'}
          inputMode={q.input ? 'decimal' : undefined}
          autoComplete="off"
          value={a.other ?? ''}
          placeholder={q.options.length ? 'Or write your own answer…' : q.secret ? 'Your answer (it stays hidden)' : 'Your answer…'}
          aria-label={q.options.length ? `Your own answer to: ${q.header || q.question}` : `Your answer to: ${q.header || q.question}`}
          onChange={(e) => write(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter(); } }}
          onKeyUp={stopKeys}
        />
      )}
    </fieldset>
  );
}

/** The questions of one ask, answered together: every question, then the answer button (and the ways to leave it). */
export function QuestionForm({ questions, busy, submit, onSubmit, children }: { questions: AgentQuestion[]; busy: boolean; submit: string; onSubmit: (answers: QuestionAnswers) => void; children?: React.ReactNode }) {
  const [answers, setAnswers] = React.useState<QuestionAnswers>({});
  const complete = answersComplete(questions, answers) && Object.values(answers).some((a) => answerText(a) !== '');
  const go = () => { if (complete && !busy) onSubmit(answers); };
  return (
    <form className="srk-qform" onSubmit={(e) => { e.preventDefault(); go(); }}>
      {questions.map((q, n) => <QuestionField key={q.id} q={q} n={n} count={questions.length} answer={answers[q.id]} onEnter={go} onChange={(a) => setAnswers((was) => ({ ...was, [q.id]: a }))} />)}
      <div className="acts">
        <button type="submit" className="yes" disabled={!complete || busy}>{busy ? 'Sending…' : submit}</button>
        {children}
      </div>
    </form>
  );
}

/** Questions as they were answered: each option, the ones he chose ticked; what he wrote; or that it went unanswered. */
export function AnsweredQuestions({ questions, answers, none }: { questions: AgentQuestion[]; answers: QuestionAnswers | null | undefined; none: string }) {
  return (
    <div className="srk-qdone">
      {questions.map((q) => {
        const a = answers?.[q.id];
        const said = answerText(a);
        return (
          <div key={q.id} className="q">
            {q.header && <small>{q.header}</small>}
            <QuestionText text={q.question} />
            {q.options.length > 0 && (
              <ul className="opts">
                {q.options.map((o) => <li key={o.label} className={a?.picked.includes(o.label) ? 'on' : ''}><i aria-hidden="true" /><span>{o.label}</span>{a?.picked.includes(o.label) && <em className="sr">(chosen)</em>}</li>)}
              </ul>
            )}
            {a?.other?.trim() && <p className="mine"><span>Your answer</span>{q.secret ? '••••' : a.other.trim()}</p>}
            {!said && <p className="none">{none}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** A question in the log: answerable here when the agent asked without waiting, else what was answered (or where). */
function QuestionBlock({ item, agent }: { item: Item<'question'>; agent: AgentKind }) {
  const ctx = React.useContext(QuestionContext);
  const label = AGENT_LABEL[agent];
  if (item.via === 'reply') {
    const answers = ctx?.replies.answers.get(item.id);
    if (!answers && ctx?.replies.open.has(item.id)) {
      const busy = ctx.replying.has(item.id);
      return (
        <div className="srk-ask srk-qcard" role="group" aria-label={`${label} asks you`}>
          <div className="h"><i aria-hidden="true" /><b>{label} asks</b><small>question</small></div>
          <QuestionForm questions={item.questions} busy={busy} submit="Send answer" onSubmit={(a) => ctx.reply(item.id, replyEntries(item.questions, a))} />
          <p className="else">{ctx.working ? 'It goes into the turn that runs now.' : `It goes to ${label} as your next message.`}</p>
        </div>
      );
    }
    return (
      <div className="srk-qcard done" role="group" aria-label={`${label} asked`}>
        <div className="h"><b>{label} asked</b><small>{answers ? 'answered' : 'not answered'}</small></div>
        <AnsweredQuestions questions={item.questions} answers={answers} none={answers ? 'Not answered.' : 'Not answered: you wrote back instead.'} />
      </div>
    );
  }
  // It waits on his answer: the card is above the composer while it does.
  if (item.status === 'running' && ctx?.waiting.has(item.id)) {
    return <p className="srk-qwait" role="status"><i aria-hidden="true" />{label} asks you {item.questions.length > 1 ? `${item.questions.length} questions` : 'a question'}: answer it below.</p>;
  }
  const none = item.status === 'done' && !item.answers ? `Answered in the ${label} app.` : 'Not answered.';
  return (
    <div className="srk-qcard done" role="group" aria-label={`${label} asked`}>
      <div className="h"><b>{label} asked</b><small>{item.answers ? 'answered' : item.status === 'running' ? 'waiting' : item.status === 'done' ? 'answered elsewhere' : 'not answered'}</small></div>
      <AnsweredQuestions questions={item.questions} answers={item.answers} none={none} />
    </div>
  );
}

/** A file's unified diff, numbered, added lines green and removed ones red. */
export function DiffView({ file }: { file: FileEdit }) {
  const lines = React.useMemo(() => parseDiff(file.diff, file.change), [file.diff, file.change]);
  if (lines.length === 0) return <pre className="srk-out empty">{file.change === 'delete' ? 'The file was deleted.' : 'No changes to show.'}</pre>;
  const shown = lines.length > DIFF_LINES_MAX ? lines.slice(0, DIFF_LINES_MAX) : lines;
  return (
    <div className="srk-diff" role="group" aria-label={`Changes to ${file.path}`}>
      {shown.map((line, i) => (
        <div key={i} className={`dl ${line.kind}`}>
          <span className="n">{line.old ?? ''}</span>
          <span className="n">{line.new ?? ''}</span>
          <span className="c">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'ctx' ? ' ' : ''}{line.text}</span>
        </div>
      ))}
      {shown.length < lines.length && <div className="more">{(lines.length - shown.length).toLocaleString()} more lines are not shown here.</div>}
    </div>
  );
}

/** One row of a step that opens to show more. */
function StepLine({ tone, tag, open, onToggle, children, canOpen = true, label }: {
  tone?: string; tag: string; open: boolean; onToggle: () => void; children: React.ReactNode; canOpen?: boolean; label: string;
}) {
  return (
    <button type="button" className="srk-sline" aria-expanded={canOpen ? open : undefined} disabled={!canOpen} onClick={onToggle} aria-label={label} title={label}>
      <span className={`srk-tag${tone ? ` ${tone}` : ''}`} aria-hidden="true">{tag}</span>
      {children}
    </button>
  );
}

function CommandStep({ item, cwd }: { item: Item<'command'>; cwd: string }) {
  const outcome = commandOutcome(item);
  const [open, setOpen] = React.useState(false);
  return (
    <div className={`srk-step ${outcome.tone === 'failed' ? 'failed' : outcome.tone === 'running' ? 'running' : ''}`}>
      <StepLine tag="run" open={open} onToggle={() => setOpen(!open)} label={`Command: ${item.command} (${outcome.word})`}>
        <code>{item.command || 'a command'}</code>
        <span className="sp" />
        {outcome.tone === 'running' ? <span className="st running" role="img" aria-label="running" /> : <span className={`st ${outcome.tone}`}>{outcome.tone === 'ok' ? '✓' : outcome.word}</span>}
        {item.durationMs !== null && <span className="dur">{formatDuration(item.durationMs)}</span>}
      </StepLine>
      {open && (
        <div className="srk-open">
          {item.cwd && item.cwd !== cwd && <span className="cwd">in {item.cwd}</span>}
          {item.output ? <pre className="srk-out">{item.output}</pre> : <pre className="srk-out empty">{item.status === 'running' ? 'Nothing printed yet.' : 'It printed nothing.'}</pre>}
          {item.exitCode !== null && item.exitCode !== 0 && <span className="cwd">It exited with code {item.exitCode}.</span>}
        </div>
      )}
    </div>
  );
}

const CHANGE_TAG: Record<FileEdit['change'], string> = { add: 'new', delete: 'del', update: 'edit' };

export function FileStep({ file, cwd, status, startOpen = false }: { file: FileEdit; cwd: string; status: Item<'file-change'>['status']; startOpen?: boolean }) {
  const [open, setOpen] = React.useState(startOpen);
  const counts = React.useMemo(() => diffCounts(file), [file]);
  const path = shortPath(file.path, cwd);
  return (
    <div className={`srk-step ${status === 'failed' || status === 'declined' ? 'failed' : status === 'running' ? 'running' : ''}`}>
      <StepLine tag={CHANGE_TAG[file.change]} open={open} onToggle={() => setOpen(!open)} label={`${file.change === 'add' ? 'New file' : file.change === 'delete' ? 'Deleted' : 'Edited'} ${file.path}: ${counts.added} added, ${counts.removed} removed`}>
        <code>{path}{file.movedTo ? ` → ${shortPath(file.movedTo, cwd)}` : ''}</code>
        <span className="sp" />
        {status === 'declined' && <span className="st declined">declined</span>}
        {status === 'failed' && <span className="st failed">failed</span>}
        {counts.added > 0 && <span className="add">+{counts.added}</span>}
        {counts.removed > 0 && <span className="del">−{counts.removed}</span>}
      </StepLine>
      {open && <div className="srk-open"><DiffView file={file} /></div>}
    </div>
  );
}

function ToolStep({ item }: { item: Item<'tool'> }) {
  const [open, setOpen] = React.useState(false);
  const tone = item.status === 'failed' || item.status === 'declined' ? 'failed' : item.status === 'running' ? 'running' : '';
  return (
    <div className={`srk-step ${tone}`}>
      <StepLine tag="tool" open={open} onToggle={() => setOpen(!open)} label={`Tool ${item.name}`}>
        <code>{item.name}</code>
        <span className="sub">{toolInputLine(item.input)}</span>
        {item.status === 'running' ? <span className="st running" role="img" aria-label="running" /> : tone === 'failed' ? <span className="st failed">{item.status}</span> : null}
      </StepLine>
      {open && (
        <div className="srk-open">
          {item.input && <><span className="k">Input</span><pre className="srk-out">{prettyJson(item.input)}</pre></>}
          <span className="k">Result</span>
          {item.result ? <pre className="srk-out">{prettyJson(item.result)}</pre> : <pre className="srk-out empty">{item.status === 'running' ? 'Still running.' : 'Nothing came back.'}</pre>}
        </div>
      )}
    </div>
  );
}

function ThoughtStep({ item }: { item: Item<'reasoning'> }) {
  const [open, setOpen] = React.useState(false);
  const first = item.text.replace(/[*_`#>]+/g, '').split('\n').find((l) => l.trim()) ?? '';
  // A thought read back from a transcript has one time only: no length to say.
  const took = item.startedAt && item.endedAt && item.endedAt > item.startedAt ? formatDuration(item.endedAt - item.startedAt) : '';
  return (
    <div className="srk-step">
      <StepLine tag="think" open={open} onToggle={() => setOpen(!open)} label="What it thought">
        <span className="txt think">{first}</span>
        <span className="sp" />
        {took && <span className="dur">{took}</span>}
      </StepLine>
      {open && <div className="srk-open"><p className="think">{item.text.replace(/\*\*/g, '')}</p></div>}
    </div>
  );
}

function Step({ item, cwd }: { item: SessionItem; cwd: string }) {
  switch (item.kind) {
    case 'command': return <CommandStep item={item} cwd={cwd} />;
    case 'file-change':
      return <>{(item.files.length ? item.files : [{ path: 'files', change: 'update' as const, diff: '' }]).map((file, i) => <FileStep key={`${item.id}-${i}`} file={file} cwd={cwd} status={item.status} />)}</>;
    case 'tool': return <ToolStep item={item} />;
    case 'reasoning': return <ThoughtStep item={item} />;
    case 'web-search':
      return (
        <div className={`srk-step${item.status === 'running' ? ' running' : ''}`}>
          <StepLine tag="web" open={false} onToggle={() => {}} canOpen={false} label={`Searched the web: ${item.query}`}>
            <span className="txt">{item.query ? `Searched for “${item.query}”` : 'Searched the web'}</span>
            {item.status === 'running' && <><span className="sp" /><span className="st running" role="img" aria-label="searching" /></>}
          </StepLine>
        </div>
      );
    case 'notice':
      return (
        <div className="srk-step">
          <StepLine tag="note" open={false} onToggle={() => {}} canOpen={false} label={item.text}><span className="txt">{item.text}</span></StepLine>
        </div>
      );
    default: return null;
  }
}

/** A run of steps, tight. A long run of a finished turn folds to one line that says what it did. */
function Steps({ items, cwd, running }: { items: SessionItem[]; cwd: string; running: boolean }) {
  const long = items.length > 4;
  const [open, setOpen] = React.useState<boolean | null>(null);
  const shown = open ?? (!long || running);
  return (
    <div className="srk-steps">
      {long && (
        <button type="button" className="srk-stepsum" aria-expanded={shown} onClick={() => setOpen(!shown)}>
          <i aria-hidden="true">▸</i>{stepsSummary(items)}
        </button>
      )}
      {shown && items.map((item) => <Step key={item.id} item={item} cwd={cwd} />)}
    </div>
  );
}

function Plan({ item }: { item: Item<'plan'> }) {
  const done = item.steps.filter((s) => s.status === 'done').length;
  return (
    <div className="srk-plan" role="group" aria-label="The plan">
      <div className="h"><small>Plan</small>{item.steps.length > 0 && <span>{done} of {item.steps.length} done</span>}</div>
      {item.steps.length > 0 ? (
        <ol className="steps">{item.steps.map((step, i) => <li key={i} className={step.status}><i aria-hidden="true" /><span>{step.text}</span></li>)}</ol>
      ) : item.text ? <AgentText text={item.text} final={false} /> : null}
      {item.explanation && <p>{item.explanation}</p>}
    </div>
  );
}

function Block({ block, agent, cwd, running }: { block: TurnBlock; agent: AgentKind; cwd: string; running: boolean }) {
  switch (block.type) {
    case 'user':
      return (
        <>
          <span className="srk-who you">You{block.item.framed && <em title="The Journal sent the task’s brief in front of your first message"> · with the task’s brief</em>}{block.item.answers?.length ? <em> · answered</em> : null}</span>
          <div className="srk-m you">{block.item.text}</div>
        </>
      );
    case 'question': return <QuestionBlock item={block.item} agent={agent} />;
    case 'agent':
      return (
        <>
          {block.final && <span className="srk-who">{AGENT_LABEL[agent]}</span>}
          <AgentText text={block.item.text} final={block.final} />
        </>
      );
    case 'steps': return <Steps items={block.items} cwd={cwd} running={running} />;
    case 'plan': return <Plan item={block.item} />;
    case 'notice': return <p className={`srk-notice ${block.item.level}`} role={block.item.level === 'error' ? 'alert' : undefined}>{block.item.text}</p>;
  }
}

/** One turn: its blocks, how it ended when that is worth saying, and how long it worked. Drawn again only when it changed. */
export const Turn = React.memo(function Turn({ turn, agent, cwd, limits }: { turn: SessionTurn; agent: AgentKind; cwd: string; limits: RateLimitSummary | null }) {
  const blocks = turnBlocks(turn);
  const running = turn.status === 'running';
  const took = turn.startedAt && turn.endedAt && turn.endedAt > turn.startedAt ? formatDuration(turn.endedAt - turn.startedAt) : '';
  return (
    <section className="srk-turn">
      {blocks.map((block) => <Block key={block.type === 'steps' ? block.id : block.item.id} block={block} agent={agent} cwd={cwd} running={running} />)}
      {turn.status === 'failed' && (
        <div className={`srk-fail${turn.limited ? ' limit' : ''}`} role="alert">
          <b>{turn.limited ? 'Usage limit' : 'This turn failed'}</b>
          <span>{failureText(agent, turn, limits)}</span>
        </div>
      )}
      {turn.status === 'interrupted' && <p className="srk-note">Stopped{took ? ` after ${took}` : ''}.</p>}
      {turn.status === 'done' && took && blocks.some((b) => b.type === 'steps') && <span className="srk-tmeta">Worked for {took}</span>}
    </section>
  );
});
