'use client';

import React from 'react';
import { claudeCodePrompt } from '@/lib/bugs-features/prompt';
import type { BugFeatureStatus, BugFeatureView } from '@/lib/bugs-features/types';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** First line of the description, or of the prompt when there is no description. */
export function itemTitle(item: Pick<BugFeatureView, 'description' | 'prompt' | 'images'>): string {
  const line = (item.description.trim() || item.prompt.trim()).split('\n')[0].trim();
  if (line) return line.length > 140 ? `${line.slice(0, 138)}…` : line;
  return item.images.length ? 'Screenshot only' : 'Untitled';
}

interface BugFeatureCardProps {
  item: BugFeatureView;
  fresh?: boolean;
  /** The page has room for the full description; the drawer shows the title only. */
  showDescription?: boolean;
  onCopy: (item: BugFeatureView) => void;
  onEdit: (item: BugFeatureView) => void;
  onStatus: (item: BugFeatureView, status: BugFeatureStatus) => void;
  onDelete: (item: BugFeatureView) => void;
  onZoom: (url: string) => void;
}

export function BugFeatureCard({
  item,
  fresh,
  showDescription,
  onCopy,
  onEdit,
  onStatus,
  onDelete,
  onZoom,
}: BugFeatureCardProps) {
  const [previewing, setPreviewing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const shipped = item.status === 'shipped';
  const title = itemTitle(item);
  const restOfDescription = item.description.trim().split('\n').slice(1).join('\n').trim();

  return (
    <article className={`bf-card${shipped ? ' shipped' : ''}${fresh ? ' fresh' : ''}`}>
      {item.imageUrls.length > 0 && (
        <button
          type="button"
          className="bf-banner"
          onClick={() => onZoom(item.imageUrls[0])}
          aria-label="View screenshot"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imageUrls[0]} alt="" loading="lazy" />
          {item.imageUrls.length > 1 && (
            <span className="more">+{item.imageUrls.length - 1} more</span>
          )}
        </button>
      )}
      <div className="bf-cardin">
        <div className="bf-cardtop">
          <span className="bf-kd" data-kind={item.kind}>
            <i />
            {item.kind}
            {shipped ? ' · shipped' : ''}
          </span>
          {item.page && <span>{item.page}</span>}
          <span>{formatWhen(item.createdAt)}</span>
        </div>
        <h3>{title}</h3>
        {showDescription && restOfDescription && <p className="bf-desc">{restOfDescription}</p>}
        {item.prompt.trim() ? (
          <div className="bf-pr">
            <span>{item.prompt.trim()}</span>
          </div>
        ) : (
          <p className="bf-nopr">
            No prompt yet. Copying asks Claude Code to propose one from the description.
          </p>
        )}
        <div className="bf-acts">
          {confirming ? (
            <>
              <span className="bf-confirm">Delete this and its screenshots?</span>
              <button type="button" className="bf-btn small danger" onClick={() => onDelete(item)}>
                Delete
              </button>
              <button
                type="button"
                className="bf-btn small ghost"
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <>
              {!shipped && (
                <button type="button" className="bf-btn small rise" onClick={() => onCopy(item)}>
                  Copy for Claude Code
                </button>
              )}
              <button
                type="button"
                className="bf-btn small ghost"
                onClick={() => setPreviewing((v) => !v)}
              >
                {previewing ? 'Hide' : 'Preview'}
              </button>
              <button type="button" className="bf-btn small ghost" onClick={() => onEdit(item)}>
                Edit
              </button>
              <button
                type="button"
                className="bf-btn small ghost"
                onClick={() => onStatus(item, shipped ? 'open' : 'shipped')}
              >
                {shipped ? 'Reopen' : 'Mark shipped'}
              </button>
              <button
                type="button"
                className="bf-btn small ghost danger gap"
                onClick={() => setConfirming(true)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {previewing && <pre className="bf-pre">{claudeCodePrompt(item)}</pre>}
    </article>
  );
}
