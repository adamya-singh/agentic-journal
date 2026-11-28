'use client';

// A write-up as a post. Every section opens as a sentence or two (its gist) and zooms twice: into the story
// (the paragraph and its chart), then into everything (settings, every number, files). The control at the top
// zooms all of them at once and keeps the section being read where it is on the screen.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PREDICTION_WORDS, type PostBlock, type PostFigure, type PostSection, type PostTone, type RunPost } from '@/lib/experiments/types';

const TONE: Record<PostTone, string> = { accent: '#a8541c', blue: '#3d6fa3', soft: '#d9a57e', grey: '#7b8798', good: '#2f7d4f', bad: '#c2452d', warn: '#c98a1a' };
const LEVELS = ['Gist', 'Story', 'Everything'] as const;
const depth = (section: PostSection) => (section.detail.length > 0 ? 3 : section.story.length > 0 ? 2 : 1);

const Md = ({ text, inline }: { text: string; inline?: boolean }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    p: ({ children }) => (inline ? <>{children}</> : <p>{children}</p>),
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  }}>{text}</ReactMarkdown>
);

// ---- Scales shared by the charts
const short = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`);
const sci = (v: number) => (v !== 0 && (Math.abs(v) < 0.01 || Math.abs(v) >= 10000) ? v.toExponential(1).replace('+', '') : short(v));
/** About five round ticks from 0 (or the lowest value) to the highest. */
function ticks(lo: number, hi: number): number[] {
  const span = hi - lo || 1, raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toPrecision(10));
  return out;
}
/** The y scale of a chart: decades when log, round numbers from zero when not. */
function yScale(values: number[], log: boolean, top: number, bottom: number) {
  if (log) {
    const lo = Math.floor(Math.log10(Math.min(...values))), hi = Math.ceil(Math.log10(Math.max(...values)));
    const span = Math.max(1, hi - lo);
    return { at: (v: number) => top + (bottom - top) * (lo + span - Math.log10(v)) / span, ticks: Array.from({ length: span + 1 }, (_, i) => 10 ** (lo + i)), name: (v: number) => v.toExponential(0).replace('+', ''), floor: 10 ** lo };
  }
  const marks = ticks(Math.min(0, ...values), Math.max(...values)), lo = marks[0]!, hi = Math.max(marks[marks.length - 1]!, Math.max(...values));
  return { at: (v: number) => top + (bottom - top) * (hi - v) / (hi - lo || 1), ticks: marks, name: short, floor: lo };
}

function Bars({ f }: { f: Extract<PostFigure, { type: 'bars' }> }) {
  return (
    <div className="xo-bars" role="img" aria-label={f.rows.map((row) => `${row.label}: ${row.value} of ${f.of}`).join(', ')}>
      {f.rows.map((row) => (
        <React.Fragment key={row.label}>
          <span className={row.strong ? 'strong' : undefined}>{row.label}</span>
          <span className="track"><i style={{ width: `${(100 * row.value) / f.of}%`, background: TONE[row.tone] }} /></span>
          <span className={`n${row.strong ? ' strong' : ''}`}>{row.value}</span>
          <span className="note">{row.note}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function Lines({ f }: { f: Extract<PostFigure, { type: 'lines' }> }) {
  const W = 680, H = 300, L = 52, R = 22, T = 14, B = 36;
  const xs = f.series.flatMap((s) => s.points.map((p) => p[0])), xLo = Math.min(0, ...xs), xHi = Math.max(...xs);
  const y = yScale([...f.series.flatMap((s) => s.points.map((p) => p[1])), ...f.marks.map((m) => m.y), ...f.callouts.map((c) => c.y)], f.log, T, H - B);
  const x = (v: number) => L + (W - L - R) * (v - xLo) / (xHi - xLo || 1);
  return (
    <div className="xo-plot">
      <div className="xo-key">{f.series.map((s) => <span key={s.name}><i className="line" style={{ borderTopColor: TONE[s.tone], borderTopStyle: s.dashed ? 'dashed' : 'solid', borderTopWidth: s.thin ? 1.2 : 2.5 }} />{s.name}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${f.series.map((s) => s.name).join(', ')} against ${f.x || 'x'}`}>
        {y.ticks.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={y.at(v)} y2={y.at(v)} /><text x={L - 8} y={y.at(v) + 4} textAnchor="end">{y.name(v)}</text></g>)}
        {ticks(xLo, xHi).map((v) => <g key={v}><line className="axis" x1={x(v)} x2={x(v)} y1={H - B} y2={H - B + 4} /><text x={x(v)} y={H - B + 18} textAnchor="middle">{short(v)}</text></g>)}
        <text x={W - R} y={H - 3} textAnchor="end">{f.x}</text>
        {f.marks.map((m) => <g key={m.label}><line className="mark" x1={L} x2={W - R} y1={y.at(m.y)} y2={y.at(m.y)} /><text className="ink" x={W - R} y={y.at(m.y) + 15} textAnchor="end">{m.label}</text></g>)}
        {f.series.map((s) => {
          const last = s.points[s.points.length - 1]!, right = x(last[0]) > W - R - 110;
          return (
            <g key={s.name}>
              <path d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y.at(p[1]).toFixed(1)}`).join(' ')} fill="none" stroke={TONE[s.tone]} strokeWidth={s.thin ? 1.1 : 2.2} strokeDasharray={s.dashed ? '5 5' : undefined} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p) => <circle key={p[0]} cx={x(p[0])} cy={y.at(p[1])} r={s.thin ? 2 : 2.6} fill={TONE[s.tone]}><title>{`${s.name}, ${short(p[0])}: ${sci(p[1])}`}</title></circle>)}
              {s.end && <text x={x(last[0]) + (right ? -6 : 9)} y={y.at(last[1]) + (right ? -10 : 4)} textAnchor={right ? 'end' : 'start'} fill={TONE[s.tone]} style={{ fill: TONE[s.tone] }}>{s.end}</text>}
            </g>
          );
        })}
        {f.callouts.map((c) => {
          // The words go under the point, clear of the lines coming down to it.
          const cy = y.at(c.y), ty = Math.min(H - B - 8, cy + 62);
          return <g key={c.label}><line className="axis" x1={x(c.x)} x2={x(c.x)} y1={cy + 6} y2={ty - 13} /><circle cx={x(c.x)} cy={cy} r={4.5} fill="#fff" stroke={TONE[c.tone]} strokeWidth={2} /><text className="ink" x={x(c.x)} y={ty} textAnchor="middle">{c.label}</text></g>;
        })}
      </svg>
    </div>
  );
}

function Outcomes({ f }: { f: Extract<PostFigure, { type: 'outcomes' }> }) {
  const tone = Object.fromEntries(f.legend.map((one) => [one.code, one])), n = f.rows[0]!.cells.length;
  return (
    <div className="xo-plot">
      <div className="xo-key">{f.legend.map((one) => <span key={one.code}><i style={{ background: TONE[one.tone] }} />{one.label}</span>)}</div>
      <div className="xo-grid" style={{ gridTemplateColumns: `minmax(118px,1.3fr) repeat(${n},minmax(28px,1fr)) 62px`, minWidth: 190 + n * 34 }}>
        <span className="h left">{f.column}</span>
        {Array.from({ length: n }, (_, i) => <span key={i} className="h">{i}</span>)}
        <span className="h right" />
        {f.rows.map((row) => (
          <React.Fragment key={row.label}>
            {row.gap && <span className="sep" />}
            <span className="name">{row.label}</span>
            {row.cells.map((cell, i) => <span key={i} className="cell" title={`${f.column || 'case'} ${i}: ${cell.split('').map((code) => tone[code]?.label).join(', ')}`}>{cell.split('').map((code, j) => <i key={j} style={{ background: TONE[tone[code]?.tone ?? 'grey'] }} />)}</span>)}
            <span className="tot">{row.total}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function Columns({ f }: { f: Extract<PostFigure, { type: 'columns' }> }) {
  const W = 680, H = 210, L = 52, R = 22, T = 24, B = 32;
  const y = yScale([...f.bars.map((b) => b.value), ...f.marks.map((m) => m.y)], f.log, T, H - B), step = (W - L - R) / f.bars.length, wide = Math.min(30, step * 0.6);
  return (
    <div className="xo-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={f.bars.map((b) => `${b.label}: ${sci(b.value)}${b.top ? `, ${b.top}` : ''}`).join('; ')}>
        {y.ticks.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={y.at(v)} y2={y.at(v)} /><text x={L - 8} y={y.at(v) + 4} textAnchor="end">{y.name(v)}</text></g>)}
        {f.bars.map((b, i) => {
          const cx = L + step * i + step / 2, top = y.at(b.value);
          return (
            <g key={b.label}>
              <rect x={cx - wide / 2} y={top} width={wide} height={Math.max(0, y.at(y.floor) - top)} rx={3} fill={TONE[b.tone]}><title>{`${b.label}: ${sci(b.value)}${b.top ? `, ${b.top}` : ''}`}</title></rect>
              <text x={cx} y={H - B + 16} textAnchor="middle">{b.label}</text>
              {b.top && <text className="ink" x={cx} y={top - 6} textAnchor="middle">{b.top}</text>}
            </g>
          );
        })}
        {f.marks.map((m) => <g key={m.label}><line className="mark" x1={L} x2={W - R} y1={y.at(m.y)} y2={y.at(m.y)} /><text className="ink" x={W - R} y={y.at(m.y) - 5} textAnchor="end">{m.label}</text></g>)}
        <text x={W - R} y={H - 2} textAnchor="end">{f.x}</text>
      </svg>
    </div>
  );
}

const Figure = ({ figure: f }: { figure: PostFigure }) => (f.type === 'bars' ? <Bars f={f} /> : f.type === 'lines' ? <Lines f={f} /> : f.type === 'outcomes' ? <Outcomes f={f} /> : <Columns f={f} />);

function Command({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <div className="xo-cmd">
      <code>{text}</code>
      <button type="button" className="xw-b" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1600); })}>{done ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
/** A queue's log: the first result word of a line (ok, failed, trouble, running, waiting) carries its colour. */
const Listing = ({ text }: { text: string }) => (
  <pre className="xo-list">{text.split('\n').map((line, i) => {
    const found = /^(.*?\s)(ok|failed|trouble|running|waiting)(\s.*|)$/.exec(line);
    return <React.Fragment key={i}>{i > 0 && '\n'}{found ? <>{found[1]}<span className={found[2]}>{found[2]}</span>{found[3]}</> : line}</React.Fragment>;
  })}</pre>
);

/** What a block may ask of the page around it: making a follow-up an experiment, or planning it with OpenClaw. */
export interface PostActs { follow: (next: { title: string; why: string }) => void; plan: (next: { title: string; why: string }) => void }

function Block({ block: b, acts }: { block: PostBlock; acts: PostActs }) {
  if (b.kind === 'predictions') return <ul className="xo-preds">{b.items.map((p) => <li key={p.text}><em className={`xw-st ${p.result}`}>{PREDICTION_WORDS[p.result]}</em><span>{p.text}</span></li>)}</ul>;
  if (b.kind === 'checks') return <ul className="xw-check">{b.items.map((item) => <li key={item.text} className={item.ok ? undefined : 'no'}><i aria-hidden="true">{item.ok ? '✓' : '!'}</i><span><span className="xw-sr">{item.ok ? 'Checked: ' : 'Open: '}</span>{item.text}</span></li>)}</ul>;
  if (b.kind === 'next') {
    return (
      <div className="xw-next">
        {b.items.map((next) => (
          <div key={next.title}>
            <b>{next.title}</b>
            {next.why && <span>{next.why}</span>}
            <div className="xw-acts">
              <button type="button" className="xw-b go" onClick={() => acts.follow(next)}>Add as experiment</button>
              <button type="button" className="xw-b" onClick={() => acts.plan(next)}>Plan it with OpenClaw</button>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (b.kind === 'text') return <Md text={b.text} />;
  if (b.kind === 'listing') return <Listing text={b.text} />;
  if (b.kind === 'command') return <Command text={b.text} />;
  if (b.kind === 'files') return <ul className="xw-files">{b.files.map((file) => <li key={file.path}><code>{file.path}</code>{file.note && <span>{file.note}</span>}</li>)}</ul>;
  if (b.kind === 'table') {
    return (
      <div className="xw-tw"><table>
        {b.head.some(Boolean) && <thead><tr>{b.head.map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead>}
        <tbody>{b.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}</tr>)}</tbody>
      </table></div>
    );
  }
  return <figure className="xo-fig"><Figure figure={b.figure} />{b.caption && <figcaption><Md text={b.caption} inline /></figcaption>}</figure>;
}

/** The nearest thing above an element that scrolls, for keeping his place when sections change size. */
function scroller(from: HTMLElement): HTMLElement | Window {
  for (let el = from.parentElement; el; el = el.parentElement) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el;
  return window;
}

export function PostView({ post, acts }: { post: RunPost; acts: PostActs }) {
  const [levels, setLevels] = React.useState<number[]>(() => post.sections.map(() => 1));
  const root = React.useRef<HTMLDivElement>(null);
  const keep = React.useRef<{ el: HTMLElement; top: number } | null>(null);
  // A write-up read again with other sections starts from the gist.
  const shape = post.sections.map((section) => section.name).join('\n');
  React.useEffect(() => { setLevels(shape.split('\n').map(() => 1)); }, [shape]);
  React.useLayoutEffect(() => {
    const held = keep.current;
    keep.current = null;
    if (!held || !root.current) return;
    const moved = held.el.getBoundingClientRect().top - held.top;
    if (moved) scroller(root.current).scrollBy(0, moved);
  }, [levels]);

  const zoom = (index: number, to: number) => setLevels((was) => was.map((level, i) => (i === index ? Math.max(1, Math.min(depth(post.sections[i]!), to)) : level)));
  const zoomAll = (to: number) => {
    // The section at the top of what he sees stays put while the ones around it grow or shrink.
    const bar = root.current?.querySelector('.xo-bar')?.getBoundingClientRect().bottom ?? 0;
    const first = [...(root.current?.querySelectorAll<HTMLElement>('.xo-sec') ?? [])].find((el) => el.getBoundingClientRect().bottom > bar + 8);
    if (first && first.getBoundingClientRect().top < bar) keep.current = { el: first, top: first.getBoundingClientRect().top };
    setLevels(post.sections.map((section) => Math.min(to, depth(section))));
  };
  const all = (to: number) => post.sections.every((section, i) => levels[i] === Math.min(to, depth(section)));
  const chosen = [3, 2, 1].find((to) => all(to) && post.sections.some((section) => depth(section) >= to || to === 1));

  return (
    <div className="xo" ref={root}>
      <div className="xo-bar" role="group" aria-label="Zoom every section">
        <span>Zoom</span>
        <span className="xo-seg">{LEVELS.map((name, i) => <button key={name} type="button" aria-pressed={chosen === i + 1} onClick={() => zoomAll(i + 1)}>{name}</button>)}</span>
        <span className="hint">or press a section</span>
      </div>
      {post.title && <h3 className="xo-title">{post.title}</h3>}
      {post.tldr && <p className="xo-tldr"><b>TL;DR:</b> <Md text={post.tldr} inline /></p>}
      {post.sections.map((section, index) => {
        const level = levels[index] ?? 1, most = depth(section);
        return (
          <section key={section.name} className="xo-sec" aria-label={section.name}>
            <div className="xo-head">
              <span className="xw-lab">{section.name}</span>
              {most > 1 && (
                <span className="xo-step">
                  <button type="button" aria-label={`Zoom out of ${section.name}`} disabled={level <= 1} onClick={() => zoom(index, level - 1)}>−</button>
                  <span className="dots" aria-hidden="true">{Array.from({ length: most }, (_, i) => <i key={i} className={i < level ? 'on' : undefined} />)}</span>
                  <button type="button" aria-label={`Zoom in on ${section.name}`} disabled={level >= most} onClick={() => zoom(index, level + 1)}>+</button>
                </span>
              )}
            </div>
            {level === 1 && (most > 1
              ? <button type="button" className="xo-gist" aria-label={`${section.name}: read the story`} onClick={() => zoom(index, 2)}><Md text={section.gist} inline /></button>
              : <p><Md text={section.gist} inline /></p>)}
            {level >= 2 && <div className="xo-lv">{section.story.map((block, i) => <Block key={i} block={block} acts={acts} />)}</div>}
            {level >= 3 && <div className="xo-lv deep">{section.detail.map((block, i) => <Block key={i} block={block} acts={acts} />)}</div>}
          </section>
        );
      })}
    </div>
  );
}
