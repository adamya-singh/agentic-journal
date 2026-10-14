'use client';

import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { Sunrise } from '@/components/bugs-features/icons';
import { formatShortDate } from '@/lib/compass/dates';
import { splitTopLevelItems } from '@/lib/compass/markdown-sections';
import { SHORT_TERM_SECTIONS, type ShortTermCompass } from '@/lib/compass/types';
import { CompassMarkdown } from './CompassMarkdown';

const CARD_SECTIONS = ['Relation to the long-term compass', 'Not now', 'Flow', 'Signals'] as const;
const CARD_TITLES: Record<(typeof CARD_SECTIONS)[number], string> = {
  'Relation to the long-term compass': 'Relation to the long-term compass',
  'Not now': 'Not now',
  Flow: 'Flow',
  Signals: 'Signals',
};

export function ProblemsNote({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <div className="cp-problems" role="status">
      <AlertTriangle aria-hidden="true" />
      <div>
        <b>
          {problems.length} note{problems.length === 1 ? '' : 's'} on this file
        </b>
        <ul>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CompassSections({ compass, dir }: { compass: ShortTermCompass; dir: string }) {
  if (!compass.available) {
    return (
      <div className="bf-empty">
        <Sunrise />
        <div className="bf-h">No compass yet</div>
        <div>
          OpenClaw writes the short-term compass to <code>{compass.path || `${dir}/short-term/compass.md`}</code>.
          Once the first period opens, it shows here with its history.
        </div>
      </div>
    );
  }
  const s = compass.sections;
  const focus = s.Focus ? splitTopLevelItems(s.Focus) : null;
  const known: readonly string[] = SHORT_TERM_SECTIONS;
  const extra = Object.keys(s).filter((h) => !known.includes(h));
  const end = compass.period?.end;

  return (
    <>
      <ProblemsNote problems={compass.problems} />

      {s.Period && (
        <section className="cp-sec" aria-labelledby="cp-period">
          <div className="cp-sec-head">
            <h3 className="bf-h" id="cp-period">
              Period
            </h3>
            <small>why these dates</small>
          </div>
          <div className="cp-lead">
            <CompassMarkdown markdown={s.Period} />
          </div>
        </section>
      )}

      {focus && (
        <section className="cp-sec" aria-labelledby="cp-focus">
          <div className="cp-sec-head">
            <h3 className="bf-h" id="cp-focus">
              Focus
            </h3>
            <small>
              {focus.items.length
                ? `${focus.items.length} bet${focus.items.length === 1 ? '' : 's'}, ranked`
                : 'this period'}
            </small>
          </div>
          {focus.lead && <CompassMarkdown markdown={focus.lead} />}
          {focus.items.length ? (
            <div className="cp-focus">
              {focus.items.map((item, i) => (
                <article className="cp-focus-card" key={i}>
                  <div className="cp-num" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <CompassMarkdown markdown={item.text} />
                </article>
              ))}
            </div>
          ) : (
            <div className="cp-card">
              <CompassMarkdown markdown={s.Focus} />
            </div>
          )}
          {focus.trailing && <CompassMarkdown markdown={focus.trailing} />}
        </section>
      )}

      <div className="cp-grid2">
        {CARD_SECTIONS.filter((h) => s[h]).map((h) => (
          <section className="cp-card" key={h} aria-label={CARD_TITLES[h]}>
            <h3 className="bf-h">{CARD_TITLES[h]}</h3>
            <CompassMarkdown markdown={s[h]} />
          </section>
        ))}
        {extra.map((h) => (
          <section className="cp-card wide" key={h} aria-label={h}>
            <h3 className="bf-h">{h}</h3>
            <CompassMarkdown markdown={s[h]} />
          </section>
        ))}
      </div>

      {s['For agents'] && (
        <details className="bf-term cp-agents">
          <summary className="bf-termbar">
            <ChevronRight size={13} className="chev" aria-hidden="true" />
            <span className="who">for-agents</span>
            <span className="hint">
              rules OpenClaw follows this period{end ? ` · expire ${formatShortDate(end, true)}` : ''}
            </span>
            <span className="r hint">show</span>
          </summary>
          <div className="cp-term-body">
            <CompassMarkdown markdown={s['For agents']} />
          </div>
        </details>
      )}
    </>
  );
}
