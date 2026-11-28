'use client';

// The Experiments page: Sunrise's sky with the experiments in play on it (the sun is today, one slice per active
// direction), and under it the history going down to the project's start. The sky is Sunrise's own engine
// (components/sunrise/engine.ts), given the record as lib/experiments/sunrise.ts reads it.
import React from 'react';
import { createPortal } from 'react-dom';
import { Instrument_Serif } from 'next/font/google';
import type { SunriseEngine } from '@/components/sunrise/engine';
import { SUNRISE_CSS } from '@/components/sunrise/sunrise-css';
import { PANE_CSS, TaskPane } from '@/components/sunrise/TaskPane';
import { BRIEF_CSS } from '@/components/horizon/TaskBriefCard';
import { CHAT_CSS } from '@/components/horizon/BriefChat';
import { SKY_RINGS, type ExperimentsView as View } from '@/lib/experiments/types';
import { EXPERIMENTS_CSS } from './experiments-css';
import { mountScenesIn } from './scenes';
import { ExperimentHistory } from './ExperimentHistory';
import { ExperimentPane } from './ExperimentPane';
import { WriteupTab, useWriteup } from './ExperimentWork';
import type { Experiment } from '@/lib/experiments/types';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });

type Change = (body: Record<string, unknown>) => Promise<string | void>;

/** The workspace of one experiment: the one a task gets, opening on the experiment's write-up. */
function ExperimentWorkspace({ experiment, view, onGoto, onChange, onClose, onChanged }: {
  experiment: Experiment; view: View; onGoto: (id: string) => void; onChange: Change; onClose: () => void; onChanged: () => void;
}) {
  const writeup = useWriteup(experiment.id);
  const asker = React.useRef<((text: string) => void) | null>(null);
  const ask = React.useCallback((text: string) => asker.current?.(text), []);
  return (
    // The work surfaces and the chats with OpenClaw are kept under the experiment's id. What the record knows (its
    // picture, its result, his notes, groups and flag) heads the brief.
    <TaskPane
      taskId={`exp-${experiment.id}`}
      data={view.sunrise}
      record
      briefHead={<ExperimentPane experiment={experiment} view={view} onGoto={onGoto} onChange={onChange} />}
      sheets={[
        { id: 'writeup', label: 'Write-up', tag: experiment.status === 'running' ? 'running' : undefined, node: <WriteupTab experiment={experiment} writeup={writeup} onChange={onChange} onAsk={ask} /> },
      ]}
      asker={asker}
      onClose={onClose}
      onGoto={(id) => onGoto(id.replace(/^exp-/, ''))}
      onChanged={onChanged}
      onLetGo={() => {}}
      onUndo={() => {}}
    />
  );
}

export function ExperimentsView() {
  const skyRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<SunriseEngine | null>(null);
  const [engine, setEngine] = React.useState<SunriseEngine | null>(null);
  const [view, setView] = React.useState<View | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const viewRef = React.useRef<View | null>(null);
  viewRef.current = view;

  const load = React.useCallback(() => {
    fetch('/api/experiments', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) { setView(json.data as View); setError(null); }
        else setError(json.error || 'Could not load the experiments');
      })
      .catch(() => setError('Could not load the experiments'));
  }, []);
  // On load, when the tab comes back, and every five minutes (OpenClaw and other tabs write here too).
  React.useEffect(() => {
    load();
    const seen = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', seen);
    const timer = window.setInterval(load, 5 * 60_000);
    return () => { document.removeEventListener('visibilitychange', seen); window.clearInterval(timer); };
  }, [load]);

  /** One change to the record. Answers with what went wrong, or nothing. */
  const change = React.useCallback(async (body: Record<string, unknown>): Promise<string | void> => {
    try {
      const json = await fetch('/api/experiments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
      if (!json.success) return json.error || 'That did not save. Try again.';
      setView(json.data as View);
      if (body.op === 'remove') engineRef.current?.closeTask();
      if (body.op === 'create' && json.experiment?.id) engineRef.current?.openTask(`exp-${json.experiment.id as string}`);
    } catch {
      return 'That did not save: the Journal did not answer.';
    }
  }, []);

  React.useEffect(() => {
    let disposed = false;
    void import('@/components/sunrise/engine').then(async ({ SunriseEngine: Engine, loadPrograms }) => {
      const programs = await loadPrograms();
      if (disposed || !skyRef.current) return;
      const made = new Engine(skyRef.current, programs, { onOpen: setOpen, onTray: () => {}, onToggleDaily: () => {} }, {
        ringNames: SKY_RINGS, sunWord: 'TODAY', single: true, pictures: true,
        quiet: ['Nothing in play.', 'Add an experiment, or put a direction on the sky from the list under the horizon.'],
        note: () => {
          const now = viewRef.current;
          if (!now) return '';
          const running = now.experiments.filter((e) => e.status === 'running').length, flagged = now.experiments.filter((e) => e.flagged).length;
          return `${now.project} · ${now.experiments.length} experiments · ${running} running · ${flagged} flagged for follow-up`;
        },
        label: 'Experiments in play, one slice per direction: running nearest the sun, then flagged, then the latest results',
      });
      engineRef.current = made;
      setEngine(made);
    }).catch((err) => { console.error('The experiments sky could not start:', err); if (!disposed) setError('The sky could not start'); });
    return () => {
      disposed = true;
      engineRef.current?.destroy();
      engineRef.current = null;
      setEngine(null);
    };
  }, []);
  React.useEffect(() => { if (engine && view) engine.update(view.sunrise); }, [engine, view]);
  // The engine draws each form's picture as an empty canvas (lib/shapes/render.ts); the 3D scene is started on it
  // here, whenever the sky draws forms again.
  React.useEffect(() => {
    const sky = skyRef.current;
    if (!engine || !sky) return;
    mountScenesIn(sky);
    const seen = new MutationObserver(() => mountScenesIn(sky));
    seen.observe(sky, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, [engine]);
  // A link to one experiment (/experiments?open=36) opens it once the sky is up.
  const linked = React.useRef(false);
  React.useEffect(() => {
    if (!engine || !view || linked.current) return;
    linked.current = true;
    const id = new URLSearchParams(location.search).get('open');
    if (id && view.experiments.some((e) => e.id === id)) engine.openTask(`exp-${id}`);
  }, [engine, view]);

  const openExperiment = React.useCallback((id: string) => {
    skyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    engineRef.current?.openTask(`exp-${id}`);
  }, []);
  // On the sky and in the workspace an experiment goes by "exp-<number>".
  const opened = open && view ? view.experiments.find((e) => `exp-${e.id}` === open) ?? null : null;
  // An open experiment that is gone (deleted somewhere else) closes.
  React.useEffect(() => { if (open && view && !opened) engineRef.current?.closeTask(); }, [open, view, opened]);

  return (
    <>
      <section className={`sr-hero ${serif.variable}`} aria-label="Experiments in play">
        <style dangerouslySetInnerHTML={{ __html: SUNRISE_CSS + BRIEF_CSS + CHAT_CSS + PANE_CSS + EXPERIMENTS_CSS }} />
        <div ref={skyRef} className="sr-sky" tabIndex={0} aria-label="Experiments on rings, one slice per direction. Press one to open it. Escape closes." />
        {!engine && <div className="sr-loading">{error || 'Loading the experiments…'}</div>}
        {engine && error && !view && <div className="sr-loading">{error}</div>}
        {engine && view && createPortal(
          <button type="button" className="xs-add" onClick={(event) => { event.stopPropagation(); void change({ op: 'create' }); }}>+ Experiment</button>,
          engine.slots.cap,
        )}
        {engine && view && opened && createPortal(
          <ExperimentWorkspace key={open} experiment={opened} view={view} onGoto={openExperiment} onChange={change} onClose={() => engineRef.current?.closeTask()} onChanged={load} />,
          engine.slots.pane,
        )}
        {engine && view && error && <span className="xs-err" role="alert">{error}</span>}
      </section>
      {view && <div className={serif.variable}><ExperimentHistory view={view} onOpen={openExperiment} onChange={change} /></div>}
    </>
  );
}
