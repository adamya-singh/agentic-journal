'use client';

import React from 'react';
import { Sunrise } from '@/components/bugs-features/icons';
import { hoursSince, relativeTime } from '@/lib/compass/dates';
import type { LongTermCompass, LongTermPart } from '@/lib/compass/types';
import { CompassMarkdown } from './CompassMarkdown';
import { ProblemsNote } from './CompassSections';

const STALE_HOURS = 48;

function MirrorCard({ part }: { part: LongTermPart }) {
  return (
    <section className="cp-card cp-lt-card" aria-label={part.file}>
      <div className="cp-chiprow">
        <span className="cp-chip file">{part.file}</span>
        {part.symlink && <span className="cp-chip warn">symlink</span>}
        {!part.exists && <span className="cp-chip off">missing</span>}
        {part.exists && !part.markerFound && <span className="cp-chip warn">marker not found</span>}
      </div>
      <h3 className="bf-h">{part.label}</h3>
      {part.text ? (
        <CompassMarkdown markdown={part.text} />
      ) : part.exists ? (
        <p className="cp-note warn">
          The mirror exists but “{part.label}” was not found in it, so there is nothing to quote.
        </p>
      ) : (
        <p className="cp-note">Not mirrored yet.</p>
      )}
      <div className="cp-path">{part.path}</div>
    </section>
  );
}

export function LongTermView({ longTerm, dir, now }: { longTerm: LongTermCompass; dir: string; now: number }) {
  if (!longTerm.available) {
    return (
      <div className="bf-empty">
        <Sunrise />
        <div className="bf-h">No mirrors yet</div>
        <div>
          compass-sync copies USER.md, MEMORY.md and SOUL.md into <code>{dir}/long-term</code> every five
          minutes. The long-term compass shows here once the first sync has run.
        </div>
      </div>
    );
  }
  const stale = longTerm.mirroredAtSource === 'mtime' || hoursSince(longTerm.mirroredAt, now) > STALE_HOURS;
  return (
    <>
      <div className={`cp-mirror${stale ? ' stale' : ''}`}>
        <i aria-hidden="true" />
        <span>
          Mirrors of the OpenClaw workspace files, kept by compass-sync
          {longTerm.mirroredAt
            ? ` · last change ${relativeTime(longTerm.mirroredAt, now)}`
            : ' · never synced'}
          {longTerm.mirroredAtSource === 'mtime' ? ' (file time; no git history)' : ''}
        </span>
        <span>· edit the originals, not these</span>
      </div>
      <ProblemsNote problems={longTerm.problems} />
      <div className="cp-lt">
        <MirrorCard part={longTerm.parts.user} />
        <MirrorCard part={longTerm.parts.memory} />
        <MirrorCard part={longTerm.parts.soul} />
      </div>
    </>
  );
}
