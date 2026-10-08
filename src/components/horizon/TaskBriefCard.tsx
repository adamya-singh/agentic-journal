'use client';

// The task brief, in two sizes: the Tether card that rides beside a task, and the full brief window.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BriefLink, BriefRelated, TaskBrief } from '@/lib/task-brief';

export const BRIEF_CSS = `
.hzb{color:var(--hz-ink);font:13.5px/1.5 var(--hz-sans)}
.hzb a{color:var(--hz-em)}
.hzb-eyebrow{display:flex;flex-wrap:wrap;gap:4px 8px;font:500 10.5px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--hz-dim)}
.hzb-eyebrow b{font-weight:500;color:var(--hz-em)}
.hzb-ttl{margin:6px 0 2px;font:400 30px/1.05 var(--hz-serif);text-wrap:balance}
.hzb-full{margin:0;font-size:12.5px;color:var(--hz-dim)}
.hzb-when{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.hzb-zc{font:500 12px var(--hz-mono);padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.22);white-space:nowrap}
.hzb-zc.hold{border-color:#ff5a1f;color:#ff8a5c;background:#120a06}
.hzb-zc.ignition{background:#fff6ec;color:#1b0d05;border-color:#fff6ec;box-shadow:0 0 14px 2px rgba(255,179,122,.35)}
.hzb-zc.climb{background:rgba(255,255,255,.88);color:#10213a;border-color:transparent}
.hzb-zc.undated{border-style:dashed}
.hzb-where{font-size:12.5px;color:var(--hz-dim)}
.hzb-note{margin:6px 0 0;font-size:12.5px;color:var(--hz-dim)}
.hzb-stakes{margin:10px 0 0;color:#dfe5ee}
.hzb-next{margin-top:14px;border:1px solid rgba(255,210,168,.35);background:linear-gradient(180deg,rgba(255,210,168,.1),rgba(255,210,168,.03));border-radius:12px;padding:12px}
.hzb-lab{font:500 10px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--hz-em)}
.hzb-go{display:inline-flex;align-items:center;gap:8px;margin-top:8px;background:#ffd2a8;color:#1b0d05;border:0;border-radius:9px;padding:8px 14px;font:600 14px var(--hz-sans);text-decoration:none;cursor:pointer;max-width:100%;text-align:left}
.hzb a.hzb-go{color:#1b0d05}
.hzb-go:hover{filter:brightness(1.05)}
.hzb-next p{margin:8px 0 0;font-size:13px;color:#d6dde8}
.hzb-sec{margin-top:16px}
.hzb-sec>h4{margin:0 0 7px;font:500 10.5px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--hz-dim)}
.hzb-flags{display:grid;gap:7px}
.hzb-flag{display:grid;grid-template-columns:12px minmax(0,1fr);gap:8px;font-size:13px;line-height:1.45;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.13)}
.hzb-flag i{width:9px;height:9px;border-radius:50%;margin-top:5px}
.hzb-flag.warn{border-color:rgba(255,90,31,.45)} .hzb-flag.warn i{background:#ff5a1f}
.hzb-flag.info i{background:#8fb6ec}
.hzb-flag.gap{border-style:dashed} .hzb-flag.gap i{border:1.5px dashed #c9b8a6}
.hzb-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 14px;margin:0;font-size:13px}
.hzb-facts dt{color:var(--hz-dim);font:12px var(--hz-mono);padding-top:1px}
.hzb-facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
.hzb-steps{list-style:none;margin:0;padding:0;display:grid;gap:5px;font-size:13px}
.hzb-steps li{display:grid;grid-template-columns:16px minmax(0,1fr);gap:8px}
.hzb-steps li::before{content:"";width:12px;height:12px;border:1.5px solid rgba(255,255,255,.22);border-radius:3px;margin-top:3px}
.hzb-steps li.done::before{background:#7fd1b9;border-color:#7fd1b9}
.hzb-steps li.done{color:var(--hz-dim);text-decoration:line-through}
.hzb-links{display:flex;flex-wrap:wrap;gap:6px}
.hzb-lk{display:inline-flex;gap:6px;align-items:baseline;font-size:12.5px;color:var(--hz-ink)!important;text-decoration:none;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:4px 9px;background:rgba(255,255,255,.045);max-width:100%}
.hzb-lk:hover{border-color:#ffd2a8}
.hzb-lk small{font:10px var(--hz-mono);color:var(--hz-dim);text-transform:uppercase;letter-spacing:.08em}
.hzb-lk span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hzb-rel{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.hzb-rel button{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:9px;align-items:center;width:100%;font:13px var(--hz-sans);color:var(--hz-ink);text-align:left;background:transparent;border:0;padding:4px 6px;border-radius:7px;cursor:pointer}
.hzb-rel button:hover,.hzb-rel button:focus-visible{background:rgba(255,255,255,.06);outline:none}
.hzb-rel em{font:normal 11px var(--hz-mono);color:#6f7b8d;margin-left:6px}
.hzb-rel .d{font:11px var(--hz-mono);color:var(--hz-dim);white-space:nowrap}
.hzb-dot{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--hz-dim);box-sizing:border-box}
.hzb-dot.done{background:#7fd1b9;border-color:#7fd1b9}
.hzb-dot.over{background:#ff5a1f;border-color:#ff5a1f}
.hzb-dot.target{background:#ffd2a8;border-color:#ffd2a8}
.hzb-run{display:flex;overflow-x:auto;padding:4px 0 2px}
.hzb-run button{flex:1 0 88px;min-width:88px;position:relative;padding:18px 8px 0 0;font:11.5px/1.3 var(--hz-sans);color:var(--hz-ink);text-align:left;background:transparent;border:0;cursor:pointer}
.hzb-run button::before{content:"";position:absolute;left:0;right:0;top:7px;height:1.5px;background:rgba(255,255,255,.22)}
.hzb-run button:first-child::before{left:6px}
.hzb-run .hzb-dot{position:absolute;top:3px;left:2px;background:#0a0f1b}
.hzb-run .hzb-dot.done{background:#7fd1b9} .hzb-run .hzb-dot.over{background:#ff5a1f} .hzb-run .hzb-dot.target{background:#ffd2a8}
.hzb-run b{display:block;font-weight:500}
.hzb-run span{font:10.5px var(--hz-mono);color:var(--hz-dim)}
.hzb-run .target b{color:#ffd2a8}
.hzb-run button:hover b{text-decoration:underline}
.hzb details{border-top:1px solid rgba(255,255,255,.13);padding-top:10px;margin-top:14px}
.hzb summary{cursor:pointer;font:500 10.5px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--hz-dim);list-style:none}
.hzb summary::-webkit-details-marker{display:none}
.hzb summary::before{content:"▸ ";color:#ffd2a8}
.hzb details[open] summary::before{content:"▾ "}
.hzb-md{font-size:13px;color:#d6dde8;margin-top:8px;line-height:1.55;overflow-wrap:anywhere}
.hzb-md p,.hzb-md ul,.hzb-md ol{margin:6px 0}
.hzb-md ul,.hzb-md ol{padding-left:18px}
.hzb-md strong{color:var(--hz-ink)}
.hzb-raw{white-space:pre-wrap;word-break:break-word;font:11.5px/1.5 var(--hz-mono);color:var(--hz-dim);background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.13);border-radius:8px;padding:10px;margin:8px 0 0;max-height:260px;overflow:auto}
.hzb-hist{list-style:none;margin:8px 0 0;padding:0;font-size:12.5px;display:grid;gap:3px}
.hzb-hist li{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px}
.hzb-hist time{font:11.5px var(--hz-mono);color:var(--hz-dim)}
.hzb-foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.13)}
.hzb-fb{font:500 12px var(--hz-mono);border:1px solid rgba(255,255,255,.22);background:transparent;border-radius:999px;padding:4px 12px;cursor:pointer;color:var(--hz-ink)}
.hzb-fb:hover,.hzb-fb:focus-visible{border-color:#ffd2a8;outline:none}
.hzb-fb:disabled{opacity:.5;cursor:default}
.hzb-more{margin-top:10px;background:transparent;border:0;color:#ffd2a8;font:500 12.5px var(--hz-sans);cursor:pointer;padding:0}
.hzb-x{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.25);cursor:pointer;color:var(--hz-dim);font-size:16px;line-height:1}
.hzb-x:hover,.hzb-x:focus-visible{color:var(--hz-ink);border-color:#ffd2a8;outline:none}
.hzb-loading{font-size:13px;color:var(--hz-dim);padding:6px 0}
`;

export interface BriefActions {
  onGoto: (taskId: string) => void;
  onDone: () => void;
  onLetGo?: () => void;
  busy?: boolean;
}

const KIND_LABEL: Record<string, string> = {
  assessment: 'Online assessment', exam: 'Exam', assignment: 'Assignment', 'catch-up': 'Missed class', presentation: 'Presentation',
  reading: 'Reading', build: 'Build', errand: 'Errand', plan: 'Plan', task: 'Task',
};
const LINK_KIND: Record<BriefLink['kind'], string> = {
  start: 'start', canvas: 'canvas', slides: 'slides', email: 'email', posting: 'posting', app: 'journal', link: 'link',
};

const isInternal = (href: string) => href.startsWith('/');

function Head({ brief }: { brief: TaskBrief }) {
  const w = brief.when;
  const zone = w.zone === 'hold' ? 'hold' : w.zone;
  return (
    <>
      <div className="hzb-eyebrow">
        <b>{KIND_LABEL[brief.kind] ?? brief.kind}</b>
        <span>{brief.course?.name ?? brief.group}</span>
        {brief.course?.code && <span>{brief.course.code}</span>}
      </div>
      <h3 className="hzb-ttl">{brief.short}</h3>
      {brief.title !== brief.short && <p className="hzb-full">{brief.title}</p>}
      <div className="hzb-when">
        <span className={`hzb-zc ${zone}`}>{w.day}{w.left ? ` · ${w.left}` : ''}</span>
        {w.implied && <span className="hzb-zc undated">assumed</span>}
        {w.where && <span className="hzb-where">{w.where}</span>}
      </div>
      {w.note && <p className="hzb-note">{w.note}</p>}
      {brief.stakes && <p className="hzb-stakes">{brief.stakes}</p>}
    </>
  );
}

function Next({ brief, onGoto }: { brief: TaskBrief; onGoto: (id: string) => void }) {
  const n = brief.next;
  if (!n) return null;
  const label = <>{n.label} →</>;
  return (
    <div className="hzb-next">
      <div className="hzb-lab">Start here</div>
      {n.href ? (
        <a className="hzb-go" href={n.href} {...(isInternal(n.href) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{label}</a>
      ) : n.taskId ? (
        <button type="button" className="hzb-go" onClick={() => onGoto(n.taskId as string)}>{label}</button>
      ) : (
        <span className="hzb-go">{n.label}</span>
      )}
      {n.detail && <p>{n.detail}</p>}
    </div>
  );
}

function Flags({ brief, max }: { brief: TaskBrief; max?: number }) {
  const flags = brief.flags.slice(0, max ?? brief.flags.length);
  if (!flags.length) return null;
  return (
    <div className="hzb-sec">
      <h4>Heads up</h4>
      <div className="hzb-flags">
        {flags.map((f, i) => <div key={i} className={`hzb-flag ${f.level}`}><i /><div>{f.text}</div></div>)}
      </div>
    </div>
  );
}

function Facts({ brief, max }: { brief: TaskBrief; max?: number }) {
  const facts = brief.facts.slice(0, max ?? brief.facts.length);
  if (!facts.length) return null;
  return (
    <div className="hzb-sec">
      <h4>Facts</h4>
      <dl className="hzb-facts">
        {facts.map((f, i) => <React.Fragment key={i}><dt>{f.k}</dt><dd>{f.v}</dd></React.Fragment>)}
      </dl>
    </div>
  );
}

function Related({ brief, onGoto }: { brief: TaskBrief; onGoto: (id: string) => void }) {
  if (!brief.related.length) return null;
  const go = (r: BriefRelated) => { if (r.state !== 'target' && r.state !== 'done') onGoto(r.taskId); };
  if (brief.runway) {
    return (
      <div className="hzb-sec">
        <h4>Runway to the exam</h4>
        <div className="hzb-run">
          {brief.related.map((r) => (
            <button key={r.taskId} type="button" className={r.state} title={r.rel} onClick={() => go(r)} disabled={r.state === 'target' || r.state === 'done'}>
              <i className={`hzb-dot ${r.state}`} /><b>{r.short}</b><span>{r.day}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="hzb-sec">
      <h4>Connected</h4>
      <ul className="hzb-rel">
        {brief.related.map((r) => (
          <li key={r.taskId}>
            <button type="button" onClick={() => go(r)}>
              <i className={`hzb-dot ${r.state}`} />
              <span>{r.short}<em>{r.rel}</em></span>
              <span className="d">{r.day}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Links({ brief }: { brief: TaskBrief }) {
  if (!brief.links.length) return null;
  return (
    <div className="hzb-sec">
      <h4>Links</h4>
      <div className="hzb-links">
        {brief.links.map((l) => (
          <a key={l.href} className="hzb-lk" href={l.href} title={l.label} {...(isInternal(l.href) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            <small>{LINK_KIND[l.kind]}</small><span>{l.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="hzb-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ href, ...props }) => <a href={href} {...props} {...(href && !isInternal(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})} /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** The small card beside the task: what it is, the one thing to press, three facts and the top warning. */
export function BriefCompact({ brief, loading, onGoto, onOpenFull, onClose }: {
  brief: TaskBrief | null; loading: boolean; onGoto: (id: string) => void; onOpenFull: () => void; onClose: () => void;
}) {
  return (
    <>
      <button type="button" className="hzb-x" onClick={onClose} aria-label="Close">×</button>
      <div className="hzb">
        {!brief ? <div className="hzb-loading">{loading ? 'Gathering what the Journal knows…' : 'Could not load this task.'}</div> : (
          <>
            <Head brief={brief} />
            <Next brief={brief} onGoto={onGoto} />
            <Facts brief={brief} max={3} />
            <Flags brief={brief} max={1} />
            <button type="button" className="hzb-more" onClick={onOpenFull}>Open full brief →</button>
          </>
        )}
      </div>
    </>
  );
}

/** Everything known about the task, ordered for starting it. */
export function BriefFull({ brief, actions }: { brief: TaskBrief; actions: BriefActions }) {
  return (
    <div className="hzb">
      <Head brief={brief} />
      <Next brief={brief} onGoto={actions.onGoto} />
      <Flags brief={brief} />
      {brief.steps.length > 0 && (
        <div className="hzb-sec">
          <h4>Steps</h4>
          <ul className="hzb-steps">{brief.steps.map((s, i) => <li key={i} className={s.done ? 'done' : undefined}>{s.text}</li>)}</ul>
        </div>
      )}
      <Related brief={brief} onGoto={actions.onGoto} />
      <Facts brief={brief} />
      <Links brief={brief} />
      {brief.sections.map((s) => (
        <details key={s.title} open={brief.sections.length <= 2}>
          <summary>{s.title}</summary>
          <Markdown text={s.markdown} />
        </details>
      ))}
      {brief.history.length > 0 && (
        <details>
          <summary>History</summary>
          <ul className="hzb-hist">{brief.history.map((h, i) => <li key={i}><time>{h.when}</time><span>{h.text}</span></li>)}</ul>
        </details>
      )}
      {brief.notesMarkdown && (
        <details>
          <summary>Original notes</summary>
          <pre className="hzb-raw">{brief.notesMarkdown}</pre>
        </details>
      )}
      <div className="hzb-foot">
        <button type="button" className="hzb-fb" disabled={actions.busy} onClick={actions.onDone}>Done</button>
        {actions.onLetGo && (
          <button type="button" className="hzb-fb" disabled={actions.busy} onClick={actions.onLetGo}
            title="No longer worth doing. Takes it off your lists without counting it as done.">Let go</button>
        )}
      </div>
    </div>
  );
}
