'use client';

import React from 'react';
import { AppHeader } from '@/components/AppHeader';
import { BugFeatureCard } from '@/components/bugs-features/BugFeatureCard';
import { useBugsFeatures } from '@/components/bugs-features/BugsFeaturesProvider';
import { Sunrise } from '@/components/bugs-features/icons';
import type { BugFeatureKind } from '@/lib/bugs-features/types';

type StatusFilter = 'open' | 'shipped' | 'all';
type KindFilter = BugFeatureKind | 'all';

export default function BugsFeaturesPage() {
  const bugsFeatures = useBugsFeatures();
  const [status, setStatus] = React.useState<StatusFilter>('open');
  const [kind, setKind] = React.useState<KindFilter>('all');
  if (!bugsFeatures) return null;
  const {
    items,
    loaded,
    loadError,
    openDrawer,
    startEdit,
    copyItem,
    setStatus: changeStatus,
    remove,
    zoom,
    freshId,
  } = bugsFeatures;

  const openCount = items.filter((item) => item.status === 'open').length;
  const count = (k: BugFeatureKind) =>
    items.filter((item) => item.status === 'open' && item.kind === k).length;
  const shown = items.filter(
    (item) =>
      (status === 'all' || item.status === status) && (kind === 'all' || item.kind === kind),
  );

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <AppHeader title="Bugs/Features" subtitle="Saved for Claude Code" />
      <main className="bf-root bf-page">
        <div className="bf-page-in">
          <section className="bf-sky bf-hero">
            <div className="bf-sun" aria-hidden="true" />
            <div className="bf-hero-in">
              <div>
                <div className="bf-eyebrow">For Claude Code</div>
                <h2 className="bf-title">
                  Bugs <em>&amp;</em> features
                </h2>
              </div>
              <div className="bf-tally">
                <b>{count('bug')}</b> open bugs · <b>{count('feature')}</b> open features
                <br />
                <b>{items.length - openCount}</b> shipped
              </div>
              <button
                type="button"
                className="bf-btn rise bf-hero-new"
                onClick={() => openDrawer('new')}
              >
                New <span className="bf-k">Ctrl+.</span>
              </button>
              <div className="bf-hero-acts">
                <div className="bf-seg" role="group" aria-label="Status">
                  {(['open', 'shipped', 'all'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={status === s}
                      onClick={() => setStatus(s)}
                    >
                      {s === 'open' ? 'Open' : s === 'shipped' ? 'Shipped' : 'All'}
                    </button>
                  ))}
                </div>
                <div className="bf-seg" role="group" aria-label="Kind">
                  {(['all', 'bug', 'feature'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                    >
                      {k === 'all' ? 'Both' : k === 'bug' ? 'Bugs' : 'Features'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {loadError && <p className="bf-status err">{loadError}</p>}
          {!loaded ? null : shown.length === 0 ? (
            <div className="bf-empty">
              <Sunrise />
              <div className="bf-h">
                {status === 'shipped' ? 'Nothing shipped yet' : 'Clear skies'}
              </div>
              <div>
                {status === 'shipped'
                  ? 'Mark one shipped once Claude Code lands it.'
                  : 'Use the Bugs/Features button on any page, or press Ctrl+., to save one.'}
              </div>
            </div>
          ) : (
            <div className="bf-cards">
              {shown.map((item) => (
                <BugFeatureCard
                  key={item.id}
                  item={item}
                  fresh={item.id === freshId}
                  showDescription
                  onCopy={copyItem}
                  onEdit={startEdit}
                  onStatus={changeStatus}
                  onDelete={remove}
                  onZoom={zoom}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
