'use client';

// What a task opens to in Sunrise: the work OpenClaw started, left at the place to jump in and editable right
// here, beside everything the journal knows about the task (its brief) and a chat with OpenClaw about it.
// The engine grows the pane out of the task's form; this fills it.
import React from 'react';
import { getCurrentDateISO } from '@/lib/current-date';
import type { TaskBrief } from '@/lib/task-brief';
import type { ResolvedWork } from '@/lib/hook-work';
import type { SunriseData } from '@/lib/sunrise/data';
import { BriefFull } from '@/components/horizon/TaskBriefCard';
import { BriefChat } from '@/components/horizon/BriefChat';

export const PANE_CSS = `
.srp{position:absolute;inset:0;display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:10px;padding:18px 20px 16px;color:#24140a;font:14px/1.5 var(--sans)}
.srp header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.srp .k{font:500 10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#9a5a24}
.srp h2{margin:2px 0 0;font:400 clamp(24px,2.4vw,34px)/1.05 var(--serif);text-wrap:balance}
.srp .what{margin:6px 0 0;max-width:70ch;font-size:13.5px;color:#5f4632}
.srp .acts{display:flex;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.srp .acts button,.srp-b{border:1px solid rgba(60,30,10,.2);background:rgba(255,255,255,.55);border-radius:999px;padding:6px 14px;font:500 13px var(--sans);cursor:pointer;color:#24140a}
.srp .acts button:hover,.srp-b:hover{border-color:#e07a3a}
.srp .acts button:disabled,.srp-b:disabled{opacity:.5;cursor:default}
.srp .acts .doneb{background:#24140a;color:#fff6ec;border-color:#24140a}
.srp .acts .x{width:34px;height:34px;padding:0;display:grid;place-items:center}
.srp-did{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;font:12.5px var(--sans);color:#6a4426}
.srp-did span{font:500 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:#b0521c}
.srp-did i{font-style:normal}
.srp-did i::before{content:"✓ ";color:#2f7a4a}
.srp-did:empty{display:none}
.srp-main{min-height:0;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.9fr);gap:14px}
.srp-work{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border-radius:14px;background:#fff;border:1px solid rgba(90,50,20,.12);box-shadow:0 12px 40px -18px rgba(90,40,10,.45);overflow:hidden}
.srp-bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#f6f1ea;border-bottom:1px solid rgba(90,50,20,.1);font:11.5px var(--mono);color:#7a6656}
.srp-bar b{font:600 12.5px var(--sans);color:#24140a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srp-bar .fmt{text-transform:uppercase;letter-spacing:.1em;font-size:9.5px;border:1px solid rgba(90,50,20,.2);border-radius:999px;padding:1px 7px}
.srp-bar .state{margin-left:auto;white-space:nowrap}
.srp-bar a{color:#b0521c;white-space:nowrap}
.srp-body{min-height:0;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.srp-body textarea{flex:1 1 auto;width:100%;min-height:220px;resize:none;border:0;outline:none;background:transparent;color:#1f1a16;font:15px/1.6 var(--sans)}
.srp-body .line{display:flex;gap:9px;align-items:flex-start;font-size:15px}
.srp-body .line input{margin-top:5px;accent-color:#b0521c}
.srp-body .line.did span{text-decoration:line-through;color:#9a8676}
.srp-body .text{margin:0;font-size:14px;color:#5f4632;white-space:pre-wrap}
.srp-empty{display:grid;gap:10px;justify-items:start;color:#6a4426}
.srp-empty p{margin:0}
.srp-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 14px;border-top:1px solid rgba(90,50,20,.1);font:12.5px var(--sans);color:#6a4426}
.srp-foot .srp-b{padding:3px 11px;font-size:12px}
.srp-newer{flex:1 1 100%;margin:0;padding:8px 10px;border-radius:10px;background:#fff6ea;border:1px dashed rgba(176,82,28,.4);white-space:pre-wrap;max-height:160px;overflow:auto;font-size:13px;color:#3d2a1c}
.srp-when{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;font:12.5px var(--sans);color:#6a4426}
.srp-when .srp-b{padding:3px 11px;font-size:12px}
.srp-when input{border:1px solid rgba(60,30,10,.2);border-radius:999px;background:#fff;color:#24140a;height:28px;padding:0 10px;font:12px var(--sans)}
.srp-side{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border-radius:14px;overflow:hidden;background:linear-gradient(180deg,#161b30,#090c18);color:var(--hz-ink);box-shadow:0 12px 40px -18px rgba(0,0,0,.6)}
.srp-tabs{display:flex;gap:6px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.12)}
.srp-tabs button{font:500 11.5px var(--mono);border:1px solid rgba(255,255,255,.22);background:transparent;border-radius:999px;padding:3px 12px;cursor:pointer;color:var(--hz-ink)}
.srp-tabs button[aria-selected=true]{background:#ffd2a8;color:#1b0d05;border-color:#ffd2a8}
.srp-scroll{min-height:0;overflow:auto;padding:14px 16px 18px;overscroll-behavior:contain}
.srp-scroll .hzb-ttl{font-size:24px}
.srp-chat{min-height:0;display:flex;flex-direction:column}
.srp-note{color:var(--hz-dim);font:13px var(--sans)}
.srp-err{margin:0;color:#a3361a;font-size:12.5px}
.narrow .srp{padding:14px 12px 12px;grid-template-rows:auto auto minmax(0,1fr);overflow:auto}
.narrow .srp header{flex-direction:column-reverse;gap:8px}
.narrow .srp .acts{align-self:flex-end}
.narrow .srp-main{grid-template-columns:minmax(0,1fr);grid-auto-rows:minmax(260px,auto)}
`;

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const dayFrom = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const FORMAT_LABEL: Record<ResolvedWork['format'], string> = { draft: 'draft', outline: 'outline', checklist: 'checklist', text: 'notes' };
const CHECK = /^(\s*[-*] \[)( |x|X)(\] )(.*)$/;

/** The started work: a checklist you can tick, or text you can keep writing. Saves itself as you go. */
function WorkSheet({ taskId, work, onWork }: { taskId: string; work: ResolvedWork; onWork: (work: ResolvedWork | null) => void }) {
  const [body, setBody] = React.useState(work.body);
  const [state, setState] = React.useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [asText, setAsText] = React.useState(work.format !== 'checklist');
  const [showNewer, setShowNewer] = React.useState(false);
  const saved = React.useRef(work.body);
  const timer = React.useRef<number | null>(null);
  const latest = React.useRef(body);
  latest.current = body;

  const save = React.useCallback(async (text: string) => {
    if (text === saved.current) return;
    setState('saving');
    try {
      const json = await post('/api/tasks/hook-work', { taskId, action: 'save', body: text, baseHash: work.baseHash });
      if (!json?.success) { setState('failed'); return; }
      saved.current = text;
      setState('saved');
    } catch {
      setState('failed');
    }
  }, [taskId, work.baseHash]);
  const change = (text: string) => {
    setBody(text);
    setState('idle');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(text), 800);
  };
  // Leaving the task saves what is still unsaved.
  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (latest.current !== saved.current) void post('/api/tasks/hook-work', { taskId, action: 'save', body: latest.current, baseHash: work.baseHash }).catch(() => {});
  }, [taskId, work.baseHash]);

  const takeTheirs = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    const json = await post('/api/tasks/hook-work', { taskId, action: 'reset' }).catch(() => null);
    if (json?.success && json.data) {
      const next = json.data as ResolvedWork;
      saved.current = next.body;
      setBody(next.body);
      setShowNewer(false);
      onWork(next);
    }
  };

  const lines = body.split('\n');
  const toggle = (index: number) => {
    const next = lines.map((line, i) => (i === index ? line.replace(CHECK, (_, a: string, mark: string, c: string, rest: string) => `${a}${mark === ' ' ? 'x' : ' '}${c}${rest}`) : line));
    change(next.join('\n'));
  };
  const edited = work.edited || body !== work.body;

  return (
    <section className="srp-work" aria-label="The work, started">
      <div className="srp-bar">
        <b>{work.title}</b>
        <span className="fmt">{FORMAT_LABEL[work.format]}</span>
        <span className="state" role="status">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved in the Journal' : state === 'failed' ? 'Not saved. Keep typing to retry.' : edited ? 'Yours' : 'Started by OpenClaw'}</span>
        {work.href && <a href={work.href} target="_blank" rel="noopener noreferrer">Finish it there ↗</a>}
      </div>
      <div className="srp-body">
        {asText ? (
          <textarea value={body} onChange={(e) => change(e.target.value)} onBlur={() => void save(latest.current)} spellCheck aria-label={work.title} />
        ) : lines.map((line, index) => {
          const m = CHECK.exec(line);
          if (m) {
            const did = m[2] !== ' ';
            return (
              <label key={index} className={`line${did ? ' did' : ''}`}>
                <input type="checkbox" checked={did} onChange={() => toggle(index)} /> <span>{m[4]}</span>
              </label>
            );
          }
          return line.trim() ? <p key={index} className="text">{line}</p> : null;
        })}
      </div>
      <div className="srp-foot">
        {work.format === 'checklist' && <button type="button" className="srp-b" onClick={() => setAsText((v) => !v)}>{asText ? 'Show as a checklist' : 'Edit as text'}</button>}
        {work.newer && <button type="button" className="srp-b" onClick={() => setShowNewer((v) => !v)}>OpenClaw has a newer version</button>}
        {work.edited && <button type="button" className="srp-b" onClick={() => void takeTheirs()}>{work.newer ? 'Take OpenClaw’s version' : 'Back to OpenClaw’s start'}</button>}
        {showNewer && work.newer && <pre className="srp-newer">{work.newer}</pre>}
      </div>
    </section>
  );
}

export function TaskPane({ taskId, data, onClose, onGoto, onChanged, onLetGo, onUndo }: {
  taskId: string;
  data: SunriseData;
  onClose: () => void;
  onGoto: (taskId: string) => void;
  onChanged: () => void;
  onLetGo: (target: { id: string; listType: string; short: string; title: string }) => void;
  onUndo: (text: string, run: () => Promise<unknown>) => void;
}) {
  const [brief, setBrief] = React.useState<TaskBrief | null | undefined>(undefined);   // undefined while loading
  const [work, setWork] = React.useState<ResolvedWork | null | undefined>(undefined);
  const [tab, setTab] = React.useState<'brief' | 'chat'>('brief');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadBrief = React.useCallback(() => {
    fetch(`/api/tasks/brief?id=${encodeURIComponent(taskId)}`)
      .then((r) => r.json())
      .then((json) => setBrief(json.success ? json.data as TaskBrief : null))
      .catch(() => setBrief((b) => b ?? null));
  }, [taskId]);
  React.useEffect(() => { loadBrief(); }, [loadBrief]);
  // Opening a task marks it started, and brings back its work as it stands: his text, or OpenClaw's.
  React.useEffect(() => {
    let cancelled = false;
    post('/api/tasks/hook-work', { taskId, action: 'open' })
      .then((json) => { if (!cancelled) setWork(json?.success ? (json.data as ResolvedWork | null) : null); })
      .catch(() => { if (!cancelled) setWork(null); });
    return () => { cancelled = true; };
  }, [taskId]);

  // While OpenClaw is still filling the brief, check back; when it lands, the work it started arrives with it.
  const filling = brief?.agent?.status === 'queued' || brief?.agent?.status === 'running';
  const hookBody = brief?.hook?.work?.body ?? null;
  React.useEffect(() => {
    if (!filling) return;
    const timer = window.setInterval(loadBrief, 8000);
    return () => window.clearInterval(timer);
  }, [filling, loadBrief]);
  React.useEffect(() => {
    if (hookBody === null) return;
    fetch(`/api/tasks/hook-work?id=${encodeURIComponent(taskId)}`)
      .then((r) => r.json())
      .then((json) => { if (json?.success) setWork(json.data as ResolvedWork | null); })
      .catch(() => {});
  }, [hookBody, taskId]);

  const form = data.forms[taskId];
  const item = [...data.horizon.items, ...data.horizon.holds, ...data.horizon.further].find((i) => i.id === taskId);
  const listType = brief?.listType ?? form?.listType ?? item?.listType ?? 'have-to-do';
  const title = brief?.title ?? item?.title ?? form?.name ?? '';
  const short = brief?.short ?? item?.short ?? form?.name ?? 'the task';
  const undated = brief ? brief.when.zone === 'undated' : !item;
  const when = brief?.when.day ?? item?.day ?? '';

  const done = async () => {
    setBusy(true);
    setError(null);
    const body = { taskId, listType, date: getCurrentDateISO() };
    const json = await post('/api/tasks/today/complete', body).catch(() => null);
    setBusy(false);
    if (!json?.success) { setError(json?.error || 'That did not save. Try again.'); return; }
    onClose();
    onUndo(`Done: ${short}.`, () => post('/api/tasks/today/complete', body));
    onChanged();
  };
  const setWhen = async (dueDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
    setError(null);
    const json = await post('/api/tasks/update', { taskId, listType, dueDate }).catch(() => null);
    if (!json?.success) { setError(json?.error || 'That did not save. Try again.'); return; }
    onChanged();
    loadBrief();
  };
  const refresh = async () => {
    await post('/api/tasks/brief-agent', { action: 'refresh', taskId }).catch(() => null);
    loadBrief();
  };
  const startOwn = async () => {
    const json = await post('/api/tasks/hook-work', { taskId, action: 'save', body: '' }).catch(() => null);
    if (json?.success) setWork((json.data as ResolvedWork | null) ?? { title: short, format: 'text', body: '', href: null, edited: true, baseHash: null, newer: null, startedAt: null });
  };

  return (
    <div className="srp">
      <header>
        <div>
          <span className="k">{[form?.kind, when].filter(Boolean).join(' · ')}</span>
          <h2>{form?.name ?? title}</h2>
          {form?.what && <p className="what">{form.what}</p>}
          {undated && (
            <div className="srp-when">
              No date yet. When?
              <button type="button" className="srp-b" onClick={() => void setWhen(dayFrom(0))}>Today</button>
              <button type="button" className="srp-b" onClick={() => void setWhen(dayFrom(1))}>Tomorrow</button>
              <button type="button" className="srp-b" onClick={() => void setWhen(dayFrom(7))}>Next week</button>
              <input type="date" aria-label="A date for this task" min={dayFrom(0)} onChange={(e) => void setWhen(e.target.value)} />
            </div>
          )}
          {error && <p className="srp-err" role="alert">{error}</p>}
        </div>
        <div className="acts">
          <button type="button" onClick={() => onLetGo({ id: taskId, listType, short, title })} disabled={busy}
            title="No longer worth doing. Takes it off your lists without counting it as done.">Let go</button>
          <button type="button" className="doneb" onClick={() => void done()} disabled={busy}>{busy ? 'Saving…' : 'Done'}</button>
          <button type="button" className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>
      <div className="srp-did">
        {form && form.did.length > 0 && <><span>OpenClaw already</span>{form.did.map((d) => <i key={d}>{d}</i>)}</>}
      </div>
      <div className="srp-main">
        {work ? (
          <WorkSheet key={`${work.baseHash}|${work.edited}`} taskId={taskId} work={work} onWork={setWork} />
        ) : (
          <section className="srp-work" aria-label="The work">
            <div className="srp-bar"><b>{form?.next || 'Start here'}</b></div>
            <div className="srp-body">
              <div className="srp-empty">
                {work === undefined ? <p>Opening…</p> : filling ? (
                  <p>OpenClaw is getting this ready. What it starts will appear here.</p>
                ) : (
                  <p>OpenClaw has not started this one yet. It works through your tasks one at a time, soonest first.</p>
                )}
                {work === null && (
                  <>
                    {!filling && <button type="button" className="srp-b" onClick={() => void refresh()}>Ask OpenClaw to start it now</button>}
                    <button type="button" className="srp-b" onClick={() => void startOwn()}>Start it yourself here</button>
                  </>
                )}
              </div>
            </div>
            <div className="srp-foot">Everything written here stays in the Journal.</div>
          </section>
        )}
        <aside className="srp-side" aria-label="What the Journal knows">
          <div className="srp-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'brief'} onClick={() => setTab('brief')}>Brief</button>
            <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Ask OpenClaw</button>
          </div>
          {tab === 'chat' ? (
            <div className="srp-chat"><BriefChat key={taskId} taskId={taskId} title={short} onClose={() => setTab('brief')} /></div>
          ) : (
            <div className="srp-scroll">
              {brief ? (
                <BriefFull
                  brief={brief}
                  actions={{
                    onGoto,
                    busy,
                    onDone: () => void done(),
                    onRefresh: () => void refresh(),
                    onActionDone: (actionId) => { void post('/api/tasks/brief-agent', { action: 'action-done', taskId, actionId }).then(() => { onChanged(); loadBrief(); }); },
                  }}
                />
              ) : <p className="srp-note">{brief === undefined ? 'Gathering what the Journal knows…' : 'Could not load this task.'}</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
