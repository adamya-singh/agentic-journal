'use client';

// The two tabs an experiment's workspace opens with. "Understand it" is the write-up read top to bottom, in the
// order the experiment-analyze-explain skill explains a result: the short version, the setup, then one block per
// part (why, what we did, what we predicted and whether it held, the table with its baseline, the conclusion),
// whether to trust it, and what it means and what next. "Run and watch" is how the run went and where its files are:
// a post that zooms (ExperimentPost.tsx) when the write-up has one, the plain lists when it does not.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PREDICTION_WORDS, type Experiment, type Writeup } from '@/lib/experiments/types';
import { PostView } from './ExperimentPost';

type Change = (body: Record<string, unknown>) => Promise<string | void>;
export type Ask = (text: string) => void;

/** The write-up of an experiment: undefined while it loads, null when there is none. */
export function useWriteup(id: string): Writeup | null | undefined {
  const [writeup, setWriteup] = React.useState<Writeup | null | undefined>(undefined);
  React.useEffect(() => {
    let gone = false;
    const load = () => fetch(`/api/experiments/writeup?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => { if (!gone) setWriteup(json.success ? (json.data as Writeup | null) : null); })
      .catch(() => { if (!gone) setWriteup((was) => was ?? null); });
    void load();
    // Whoever analysed the run writes it from somewhere else: it is read again when he comes back to the tab.
    const seen = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', seen);
    return () => { gone = true; document.removeEventListener('visibilitychange', seen); };
  }, [id]);
  return writeup;
}

function Copy({ text, children }: { text: string; children: React.ReactNode }) {
  const [done, setDone] = React.useState(false);
  return (
    <button type="button" className="xw-b" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1600); })}>
      {done ? 'Copied' : children}
    </button>
  );
}
const Checks = ({ items }: { items: { text: string; ok: boolean }[] }) => (
  <ul className="xw-check">{items.map((item) => <li key={item.text} className={item.ok ? undefined : 'no'}><i aria-hidden="true">{item.ok ? '✓' : '!'}</i><span className="xw-sr">{item.ok ? 'Checked: ' : 'Open: '}</span>{item.text}</li>)}</ul>
);
const ASKS = ['tldr', 'Explain it to me like a new intern', 'How do we know for sure?', 'Was that a fair comparison?', 'What did we learn, and what next?'];

/** What to hand Claude Code (or OpenClaw) so an experiment with no write-up gets one. */
const request = (e: Experiment) => `Write up experiment ${e.id} ("${e.question}") for the Agentic Journal. Follow the experiment-analyze-explain skill's explanation order, then save it with PUT ${typeof location === 'undefined' ? '' : location.origin}/api/experiments/writeup as {"id": "${e.id}", "writeup": {...}}. The fields are in the journal's docs/experiments.md ("Write-ups").`;

export function UnderstandTab({ experiment: e, writeup: w, onChange, onAsk }: { experiment: Experiment; writeup: Writeup | null | undefined; onChange: Change; onAsk: Ask }) {
  const [error, setError] = React.useState('');
  if (w === undefined) return <div className="xw"><p className="xw-dim">Opening…</p></div>;
  const asks = (
    <div className="xw-asks" role="group" aria-label="Ask OpenClaw about this experiment">
      <span>Ask OpenClaw</span>
      {ASKS.map((text) => <button key={text} type="button" className="xw-chip" onClick={() => onAsk(text)}>{text}</button>)}
    </div>
  );
  if (w === null) {
    return (
      <div className="xw">
        <div className="xw-short">
          <p className="xw-lab">What the record says</p>
          <dl className="xw-step">
            <dt>The question</dt><dd>{e.question}</dd>
            {e.answer !== '' && <><dt>Outcome</dt><dd>{e.answer}</dd></>}
            {e.numbers.length > 0 && <><dt>Numbers</dt><dd>{e.numbers.join(' · ')}</dd></>}
          </dl>
        </div>
        {e.details !== '' && <p>{e.details}</p>}
        <div className="xw-none">
          <b>Nobody has written this one up yet.</b>
          <p>A write-up gives this tab the setup, each part with its table and conclusion, whether to trust it and what comes next. It is written where the run was analysed and saved here.</p>
          <div className="xw-acts"><Copy text={request(e)}>Copy the request for Claude Code</Copy></div>
        </div>
        {asks}
      </div>
    );
  }
  const follow = async (next: { title: string; why: string }) => {
    setError(await onChange({ op: 'create', experiment: { question: next.title, details: next.why, buildsOn: [e.id], direction: e.direction } }) ?? '');
  };
  return (
    <div className="xw">
      {(w.question || w.measure || w.outcome) && (
        <div className="xw-short">
          <p className="xw-lab">The short version</p>
          <dl className="xw-step">
            {w.question && <><dt>The question</dt><dd>{w.question}</dd></>}
            {w.measure && <><dt>What we measure</dt><dd>{w.measure}</dd></>}
            {w.outcome && <><dt>Outcome</dt><dd>{w.outcome}</dd></>}
          </dl>
        </div>
      )}
      {w.setup && <p><b>The setup.</b> {w.setup}</p>}
      {w.parts.map((part, index) => (
        <section key={part.title} aria-label={part.title}>
          <h4>{w.parts.length > 1 ? `${index + 1}. ` : ''}{part.title}</h4>
          <dl className="xw-step rule">
            {part.why && <><dt>Why</dt><dd>{part.why}</dd></>}
            {part.did && <><dt>What we did</dt><dd>{part.did}</dd></>}
            {part.predictions.length > 0 && (
              <><dt>We predicted</dt><dd className="xw-preds">{part.predictions.map((p) => <span key={p.text}>{p.text} <em className={`xw-st ${p.result}`}>{PREDICTION_WORDS[p.result]}</em></span>)}</dd></>
            )}
          </dl>
          {part.table && (
            <div className="xw-tw">
              <table>
                <thead><tr>{part.table.head.map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead>
                <tbody>
                  {part.table.rows.map((row, r) => (
                    <tr key={r} className={row.mark || undefined}>{row.cells.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {part.conclusion && <p className="xw-call"><b>Conclusion.</b> {part.conclusion}</p>}
        </section>
      ))}
      {w.trust.length > 0 && <section aria-label="Can I trust it?"><h4>Can I trust it?</h4><Checks items={w.trust} /></section>}
      {(w.meaning || w.lesson || w.next.length > 0) && (
        <section aria-label="What it means, and what next">
          <h4>What it means, and what next</h4>
          {(w.meaning || w.lesson) && <p>{w.meaning} {w.lesson && <><b>One lesson:</b> {w.lesson}</>}</p>}
          {w.next.length > 0 && (
            <div className="xw-next">
              {w.next.map((next) => (
                <div key={next.title}>
                  <b>{next.title}</b>
                  {next.why && <span>{next.why}</span>}
                  <div className="xw-acts">
                    <button type="button" className="xw-b go" onClick={() => void follow(next)}>Add as experiment</button>
                    <button type="button" className="xw-b" onClick={() => onAsk(`Plan this follow-up to experiment ${e.id} with me: ${next.title}. ${next.why}`.trim())}>Plan it with OpenClaw</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {error !== '' && <p className="xw-err" role="alert">{error}</p>}
        </section>
      )}
      <details className="xw-fold">
        <summary>Research log entry{w.log === '' && <small>none yet</small>}</summary>
        {w.log !== '' ? (
          <>
            <div className="xw-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{w.log}</ReactMarkdown></div>
            <div className="xw-acts"><Copy text={w.log}>Copy it</Copy></div>
          </>
        ) : (
          <>
            <p className="xw-dim">The entry for notes/research-log is written in your voice, by the summarize-experiment-as-adamya skill.</p>
            <div className="xw-acts"><button type="button" className="xw-b" onClick={() => onAsk('Write the research log entry for this experiment as me')}>Ask OpenClaw to write it as me</button></div>
          </>
        )}
      </details>
      {asks}
    </div>
  );
}

export function RunTab({ experiment: e, writeup: w, onAsk }: { experiment: Experiment; writeup: Writeup | null | undefined; onAsk: Ask }) {
  if (w === undefined) return <div className="xw"><p className="xw-dim">Opening…</p></div>;
  const run = w?.run;
  const running = e.status === 'running';
  const known = run && (run.state || run.line || run.watch.length > 0 || run.command || run.stages.length > 0 || run.housekeeping.length > 0 || run.files.length > 0);
  // The run is over and the record was never told.
  const stale = running && run && /^(finished|done|complete)/i.test(run.state);
  const asks = (
    <div className="xw-asks" role="group" aria-label="Ask OpenClaw about the run">
      <span>Ask OpenClaw</span>
      {['Status update', 'How much time is left?', 'Where are the latest videos?'].map((text) => <button key={text} type="button" className="xw-chip" onClick={() => onAsk(text)}>{text}</button>)}
    </div>
  );
  // Written as a post: it is the whole tab, under the status line.
  if (run?.post && run.post.sections.length > 0) {
    return (
      <div className="xw">
        <div className={`xw-status${running && !stale ? ' live' : ''}`}><b>{run.state || (running ? 'Running' : 'Finished')}</b><span>{run.line || e.day}</span></div>
        {stale && <p className="xw-stale">The record still says “Running”. Set its outcome in the brief.</p>}
        <PostView post={run.post} />
        {asks}
      </div>
    );
  }
  return (
    <div className="xw">
      <div className={`xw-status${running && !stale ? ' live' : ''}`}>
        <b>{run?.state || (running ? 'Running' : 'Finished')}</b>
        <span>{run?.line || (running ? `Started ${e.day}. Nothing more is recorded about the run.` : e.day)}</span>
      </div>
      {stale && <p className="xw-stale">The record still says “Running”. Set its outcome in the brief.</p>}
      {!known && <p className="xw-dim">Nothing is recorded about how this one ran: its stages, videos and files come with its write-up.</p>}
      {run && run.watch.length > 0 && (
        <section aria-label="Watch it">
          <h4>Watch it</h4>
          <div className="xw-tiles">
            {run.watch.map((tile) => (tile.href
              ? <a key={tile.title} className="xw-tile" href={tile.href} target="_blank" rel="noopener noreferrer"><b>{tile.title} ↗</b><small>{tile.note}</small></a>
              : <div key={tile.title} className="xw-tile"><b>{tile.title}</b><small>{tile.note}</small></div>))}
          </div>
        </section>
      )}
      {run && run.command !== '' && (
        <section aria-label="Run it live">
          <h4>Run it live</h4>
          <p className="xw-dim">On the training machine:</p>
          <pre className="xw-cmd">{run.command}</pre>
          <div className="xw-acts"><Copy text={run.command}>Copy the command</Copy></div>
        </section>
      )}
      {run && run.stages.length > 0 && (
        <section aria-label="How it ran">
          <h4>How it ran</h4>
          <ol className="xw-stages">
            {run.stages.map((stage) => <li key={stage.name} className={stage.state}><i aria-hidden="true" /><b>{stage.name}</b><span><span className="xw-sr">{stage.state}: </span>{stage.note}</span></li>)}
          </ol>
        </section>
      )}
      {run && run.housekeeping.length > 0 && <section aria-label="Housekeeping"><h4>Housekeeping</h4><Checks items={run.housekeeping} /></section>}
      {run && run.files.length > 0 && (
        <details className="xw-fold">
          <summary>Files and commits</summary>
          <ul className="xw-files">{run.files.map((f) => <li key={f.path}><code>{f.path}</code>{f.note && <span>{f.note}</span>}</li>)}</ul>
        </details>
      )}
      {asks}
    </div>
  );
}
