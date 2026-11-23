'use client';

// One experiment, opened in Sunrise's workspace: what it asked and found, what it built on and led to, and his
// own notes, groups and follow-up flag. Everything saves through `onChange`, which answers with an error or nothing.
import React from 'react';
import { EXPERIMENT_STATUSES, MODELS, STATUS_WORDS, type Experiment, type ExperimentsView } from '@/lib/experiments/types';
import { HUES, STATUS_COLOURS } from './experiments-css';
import { SceneCanvas } from './SceneCanvas';
import { PICTURES } from './scenes';

type Change = (body: Record<string, unknown>) => Promise<string | void>;
const split = (text: string) => text.split(',').map((part) => part.trim()).filter(Boolean);

export function ExperimentPane({ experiment: e, view, onClose, onGoto, onChange }: {
  experiment: Experiment;
  view: ExperimentsView;
  onClose: () => void;
  onGoto: (id: string) => void;
  onChange: Change;
}) {
  const direction = view.directions.find((d) => d.id === e.direction);
  const [notes, setNotes] = React.useState(e.notes);
  const [saved, setSaved] = React.useState('');
  const [error, setError] = React.useState('');
  const [sure, setSure] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  const typing = React.useRef(false);
  // Notes written somewhere else (another tab, OpenClaw) arrive unless he is in the middle of writing here.
  React.useEffect(() => { if (!typing.current) setNotes(e.notes); }, [e.notes]);
  React.useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const update = React.useCallback(async (patch: Record<string, unknown>) => {
    const problem = await onChange({ op: 'update', id: e.id, patch });
    setError(problem ?? '');
    return problem;
  }, [e.id, onChange]);
  const saveNotes = React.useCallback(async (text: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setSaved('Saving…');
    const problem = await update({ notes: text });
    setSaved(problem ? 'Not saved' : 'Saved');
  }, [update]);
  const writeNotes = (text: string) => {
    typing.current = true;
    setNotes(text);
    setSaved('');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveNotes(text), 900);
  };
  const addGroup = (input: HTMLInputElement) => {
    const name = input.value.trim().slice(0, 40);
    input.value = '';
    if (name !== '' && !e.groups.includes(name)) void update({ groups: [...e.groups, name] });
  };
  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const when = text('when') || e.when;
    const patch: Record<string, unknown> = {
      question: text('question'), answer: text('answer'), direction: text('direction'), when, numbers: split(text('numbers')),
      details: text('details'), buildsOn: split(text('buildsOn')), picture: text('picture'), model: text('model'),
    };
    // The shown date follows a new day unless he changed how it shows.
    if (text('day') !== e.day || when === e.when) patch.day = text('day');
    const details = event.currentTarget.closest('details');
    if (!(await update(patch)) && details) details.open = false;
  };

  const ledTo = view.experiments.filter((other) => other.buildsOn.includes(e.id));
  const groups = [...new Set(view.experiments.flatMap((other) => other.groups))].sort();
  const model = MODELS[e.model];
  const pictures = { ...PICTURES, ...(e.picture && !PICTURES[e.picture] ? { [e.picture]: 'Its current picture' } : {}) };
  const link = (id: string) => <button key={id} type="button" className="xp-link" onClick={() => onGoto(id)}>{id}</button>;

  return (
    <div className="xp">
      <div className="xp-in">
        <div className="xp-stage"><SceneCanvas scene={e.picture || 'stack'} drag label={`3D picture of experiment ${e.id}`} /></div>
        <div className="xp-top">
          <b>{e.id}</b><span>{e.day}</span>
          <span className="xp-dir" style={{ '--a': HUES[(direction?.hue ?? 9) % 10] } as React.CSSProperties}><i />{direction?.name ?? 'No direction'}</span>
          <span className="xp-st" style={{ '--s': STATUS_COLOURS[e.status] } as React.CSSProperties}>{STATUS_WORDS[e.status]}</span>
          {e.flagged && <span className="xp-fl">Needs follow-up</span>}
          <button type="button" className="xp-x" onClick={onClose}>Close</button>
        </div>
        <h2>{e.question}</h2>
        {e.answer !== '' && <p className="xp-a">{e.answer}</p>}
        {e.numbers.length > 0 && <ul className="xp-n">{e.numbers.map((n) => <li key={n}>{n}</li>)}</ul>}
        {e.details !== '' && <p className="xp-d">{e.details}</p>}
        {(e.buildsOn.length > 0 || ledTo.length > 0) && (
          <p className="xp-rel">
            {e.buildsOn.length > 0 && <>Builds on {e.buildsOn.map(link)}</>}
            {e.buildsOn.length > 0 && ledTo.length > 0 && ' · '}
            {ledTo.length > 0 && <>Led to {ledTo.map((other) => link(other.id))}</>}
          </p>
        )}
        {model && (
          <div>
            <p className="xp-h">Model under test · {model[0]}</p>
            <div className="xp-wide"><div className="xp-stage wide"><SceneCanvas scene={`arch_${e.model}`} wide label={`Diagram of ${model[0]}`} /></div></div>
            <p className="xp-cap">{model[1]}</p>
          </div>
        )}
        <div className="xp-acts">
          <button type="button" className="xp-b" aria-pressed={e.flagged} onClick={() => void update({ flagged: !e.flagged })}>
            {e.flagged ? 'Flagged · clear' : 'Flag for follow-up'}
          </button>
          <select aria-label="Outcome" value={e.status} onChange={(event) => void update({ status: event.target.value })}>
            {EXPERIMENT_STATUSES.map((status) => <option key={status} value={status}>{STATUS_WORDS[status]}</option>)}
          </select>
        </div>
        <div>
          <p className="xp-h">Notes</p>
          <textarea
            aria-label={`Notes on experiment ${e.id}`}
            value={notes}
            placeholder="What you noticed, what to try next, links to runs…"
            onChange={(event) => writeNotes(event.target.value)}
            onBlur={() => { typing.current = false; if (notes !== e.notes) void saveNotes(notes); }}
          />
          <div className="xp-saved" aria-live="polite">{saved}</div>
        </div>
        <div>
          <p className="xp-h">Groups</p>
          <ul className="xp-tags">
            {e.groups.map((group) => (
              <li key={group}>{group}<button type="button" aria-label={`Remove from ${group}`} onClick={() => void update({ groups: e.groups.filter((g) => g !== group) })}>×</button></li>
            ))}
            <li style={{ border: 0, padding: 0, background: 'none' }}>
              <input
                list={`xp-groups-${e.id}`}
                placeholder="Add to a group, press Enter"
                aria-label="Add to a group"
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addGroup(event.currentTarget); } }}
                onBlur={(event) => addGroup(event.currentTarget)}
              />
              <datalist id={`xp-groups-${e.id}`}>{groups.map((group) => <option key={group} value={group} />)}</datalist>
            </li>
          </ul>
        </div>
        {error !== '' && <p className="xp-err" role="alert">{error}</p>}
        <details>
          <summary>Edit this experiment</summary>
          <form className="xp-form" onSubmit={(event) => void saveEdit(event)}>
            <label>Question<input name="question" required defaultValue={e.question} /></label>
            <label>Answer in one line<input name="answer" defaultValue={e.answer} /></label>
            <div className="two">
              <label>Direction
                <select name="direction" defaultValue={e.direction}>{view.directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              </label>
              <label>Date<input name="when" type="date" required defaultValue={e.when} /></label>
              <label>Date as shown<input name="day" defaultValue={e.day} /></label>
            </div>
            <label>Key numbers, separated by commas<input name="numbers" defaultValue={e.numbers.join(', ')} /></label>
            <label>Details<textarea name="details" defaultValue={e.details} /></label>
            <label>Builds on (experiment numbers; the first is the one it grew out of)<input name="buildsOn" defaultValue={e.buildsOn.join(', ')} placeholder="36, 39" /></label>
            <div className="two">
              <label>Picture
                <select name="picture" defaultValue={e.picture || 'stack'}>{Object.entries(pictures).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
              </label>
              <label>Model diagram
                <select name="model" defaultValue={e.model}><option value="">None</option>{Object.entries(MODELS).map(([key, [name]]) => <option key={key} value={key}>{name}</option>)}</select>
              </label>
            </div>
            <div className="xp-acts">
              <button type="submit" className="xp-b go">Save</button>
              <button type="button" className="xp-b danger" onClick={() => { if (sure) void onChange({ op: 'remove', id: e.id }); else setSure(true); }}>
                {sure ? 'Press again to delete it for good' : 'Delete experiment'}
              </button>
            </div>
          </form>
        </details>
      </div>
    </div>
  );
}
