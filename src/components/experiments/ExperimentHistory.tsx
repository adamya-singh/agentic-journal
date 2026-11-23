'use client';

// Under the horizon: the record going down into the past, newest at the top, the project's start at the bottom.
// The timeline runs straight down from under the sun. Each direction is a line beside it, joined to the timeline
// where the direction began; the ones on the sky carry on up to the horizon.
import React from 'react';
import { STATUS_WORDS, type Experiment, type ExperimentsView } from '@/lib/experiments/types';
import { HUES, STATUS_COLOURS } from './experiments-css';
import { SceneCanvas } from './SceneCanvas';

const LANE = 262, CARD_W = 240, CARD_H = 82, STEP = CARD_H + 30, TOP = 62, PAD = 24;
const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function ExperimentHistory({ view, onOpen, onChange }: {
  view: ExperimentsView;
  onOpen: (id: string) => void;
  onChange: (body: Record<string, unknown>) => Promise<string | void>;
}) {
  const [find, setFind] = React.useState('');
  const [onlyFlagged, setOnlyFlagged] = React.useState(false);
  const [group, setGroup] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);

  const layout = React.useMemo(() => {
    const history = view.experiments.filter((e) => view.sky[e.id] === undefined).reverse();   // newest first
    const lanes = view.directions.filter((d) => history.some((e) => e.direction === d.id)).sort((a, b) => Number(b.active) - Number(a.active) || a.order - b.order);
    // Lanes alternate sides of the timeline, nearest first, so the directions on the sky sit under it.
    const side = new Map<string, number>();
    let left = 0, right = 0;
    lanes.forEach((lane, index) => side.set(lane.id, index % 2 === 0 ? -++left : ++right));
    const centre = PAD + left * LANE + LANE / 2;
    const width = centre + right * LANE + LANE / 2 + PAD;
    const laneX = (id: string) => centre + (side.get(id) ?? right + 1) * LANE;
    let cursor = TOP, month: string | null = null;
    const months: { month: string; y: number }[] = [];
    const lastY = new Map<string, number>();
    const firstY = new Map<string, number>();
    const cards = history.map((e) => {
      const m = e.when.slice(0, 7);
      if (m !== month) { if (month !== null) cursor += 34; months.push({ month: m, y: cursor }); cursor += 30; month = m; }
      const y = Math.max(cursor, (lastY.get(e.direction) ?? -Infinity) + STEP);
      lastY.set(e.direction, y);
      if (!firstY.has(e.direction)) firstY.set(e.direction, y);
      cursor = y + 36;
      return { e, x: laneX(e.direction), y };
    });
    const height = cursor + CARD_H + 230;
    return { lanes, cards, months, centre, width, height, laneX, lastY, firstY, count: history.length };
  }, [view]);

  // Open with the timeline in the middle.
  React.useLayoutEffect(() => {
    const node = scroller.current;
    if (node) node.scrollLeft = Math.max(0, layout.centre - node.clientWidth / 2);
  }, [layout.centre, layout.width]);

  const groups = [...new Set(view.experiments.flatMap((e) => e.groups))].sort();
  const flagged = view.experiments.filter((e) => e.flagged).length;
  const needle = find.trim().toLowerCase();
  const shown = (e: Experiment) => (!onlyFlagged || e.flagged) && (group === null || e.groups.includes(group))
    && (needle === '' || `${e.id} ${e.question} ${e.answer} ${e.notes} ${e.details} ${e.groups.join(' ')}`.toLowerCase().includes(needle));
  const addDirection = (input: HTMLInputElement) => {
    const name = input.value.trim();
    if (name !== '') void onChange({ op: 'add-direction', name });
    setAdding(false);
  };
  const first = view.experiments[0];

  return (
    <section className="xh" aria-label="The experiment history, newest first">
      <div className="xh-head">
        <h2>Under the horizon. <em>{layout.count} experiments back to {first ? monthName(first.when.slice(0, 7)) : 'the start'}.</em></h2>
        <p>Newest at the top, the project&rsquo;s start at the bottom. Press a direction to put it on the sky or take it off; press an experiment to open it.</p>
        <div className="xh-dirs">
          {view.directions.map((d) => (
            <button key={d.id} type="button" className="xh-dir" aria-pressed={d.active} style={{ '--c': HUES[d.hue % 10] } as React.CSSProperties}
              title={d.active ? 'On the sky. Press to take it off.' : 'Not on the sky. Press to put it there.'}
              onClick={() => void onChange({ op: 'direction', id: d.id, active: !d.active })}>
              <i />{d.name}<small>{d.count}</small>
            </button>
          ))}
          {adding
            ? <span className="xh-new"><input autoFocus aria-label="New direction name" placeholder="New direction" maxLength={40}
                onKeyDown={(event) => { if (event.key === 'Enter') addDirection(event.currentTarget); else if (event.key === 'Escape') setAdding(false); }}
                onBlur={(event) => addDirection(event.currentTarget)} /></span>
            : <button type="button" className="xh-dir" onClick={() => setAdding(true)}>+ Direction</button>}
        </div>
        <div className="xh-dirs">
          <input className="xh-find" type="search" value={find} placeholder="Find in questions, answers and notes" aria-label="Find experiments" onChange={(event) => setFind(event.target.value)} />
          <button type="button" className="xh-dir" aria-pressed={onlyFlagged} style={{ '--c': '#ff8a4c' } as React.CSSProperties} onClick={() => setOnlyFlagged(!onlyFlagged)}><i />Needs follow-up<small>{flagged}</small></button>
          {groups.map((name) => (
            <button key={name} type="button" className="xh-dir" aria-pressed={group === name} style={{ '--c': '#e9dcc6' } as React.CSSProperties} onClick={() => setGroup(group === name ? null : name)}>
              {name}<small>{view.experiments.filter((e) => e.groups.includes(name)).length}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="xh-scroll" ref={scroller}>
        <div className="xh-field" style={{ width: layout.width, height: layout.height }}>
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
            <path d={`M${layout.centre} 0V${layout.height - 46}`} stroke="#e9dcc6" strokeWidth="2" fill="none" />
            <circle cx={layout.centre} cy={layout.height - 46} r="5" fill="#e9dcc6" />
            {layout.lanes.map((lane) => {
              const x = layout.laneX(lane.id), colour = HUES[lane.hue % 10], top = layout.firstY.get(lane.id)!, end = layout.lastY.get(lane.id)! + CARD_H + 18;
              return (
                <g key={lane.id} fill="none" stroke={colour} strokeLinecap="round">
                  <path d={`M${x} ${top - 8}V${end}C${x} ${end + 80} ${layout.centre} ${end + 70} ${layout.centre} ${end + 160}`} strokeWidth="9" opacity=".09" />
                  <path d={`M${x} ${top - 8}V${end}C${x} ${end + 80} ${layout.centre} ${end + 70} ${layout.centre} ${end + 160}`} strokeWidth="3" />
                  {lane.active
                    ? <path d={`M${x} ${top - 8}V4`} strokeWidth="2.2" strokeDasharray=".1 8" opacity=".85" />
                    : <path d={`M${x - 9} ${top - 8}H${x + 9}`} strokeWidth="3" />}
                  <circle cx={layout.centre} cy={end + 160} r="4.5" fill={colour} stroke="none" />
                </g>
              );
            })}
            {layout.cards.map(({ e, x, y }) => {
              const lane = view.directions.find((d) => d.id === e.direction);
              return <circle key={e.id} cx={x} cy={y - 8} r="6" fill="#0b0807" stroke={HUES[(lane?.hue ?? 9) % 10]} strokeWidth="3" />;
            })}
          </svg>
          {layout.lanes.map((lane) => (
            <span key={lane.id} className="xh-name" style={{ left: layout.laneX(lane.id), '--c': HUES[lane.hue % 10] } as React.CSSProperties}>{lane.name}<small>{lane.count}</small></span>
          ))}
          {layout.months.map(({ month, y }) => <span key={month} className="xh-month" style={{ left: layout.centre, top: y + 4 }}>{monthName(month)}</span>)}
          {layout.cards.map(({ e, x, y }) => {
            const lane = view.directions.find((d) => d.id === e.direction);
            return (
              <button key={e.id} type="button" className={`xh-card${shown(e) ? '' : ' dim'}`} onClick={() => onOpen(e.id)}
                style={{ left: x - CARD_W / 2, top: y, width: CARD_W, height: CARD_H, '--c': HUES[(lane?.hue ?? 9) % 10], '--s': STATUS_COLOURS[e.status] } as React.CSSProperties}
                aria-label={`Experiment ${e.id}, ${e.day}, ${lane?.name ?? 'no direction'}, ${STATUS_WORDS[e.status]}: ${e.question}`}>
                <span className="xh-pic"><SceneCanvas scene={e.picture || 'stack'} sharp={2} label="" /></span>
                <span className="xh-text">
                  <span className="xh-brow"><b>{e.id}</b><i /><em>{STATUS_WORDS[e.status]}</em><span>{e.day}</span></span>
                  <span className="xh-q">{e.question}</span>
                </span>
                {e.flagged && <span className="xh-flag">follow-up</span>}
              </button>
            );
          })}
          <span className="xh-start" style={{ left: layout.centre, top: layout.height - 34 }}>project start</span>
        </div>
      </div>
    </section>
  );
}
