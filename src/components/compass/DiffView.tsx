'use client';

import React from 'react';
import { Check, Copy } from 'lucide-react';
import type { CommitDetail } from '@/lib/compass/types';

const RENDER_CAP_LINES = 4000;

type LineClass = 'f' | 'm' | 'h' | 'a' | 'd' | '';

/** Classifies a unified-diff line by its prefix; no diff library needed for a read-only view. */
export function classifyDiffLine(line: string): LineClass {
  if (line.startsWith('diff --git ')) return 'f';
  if (
    line.startsWith('index ') ||
    line.startsWith('+++ ') ||
    line.startsWith('--- ') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename ') ||
    line.startsWith('Binary files')
  )
    return 'm';
  if (line.startsWith('@@')) return 'h';
  if (line.startsWith('+')) return 'a';
  if (line.startsWith('-')) return 'd';
  return '';
}

export function DiffView({ detail }: { detail: CommitDetail }) {
  const [copied, setCopied] = React.useState(false);
  const lines = React.useMemo(() => detail.diff.replace(/\n$/, '').split('\n'), [detail.diff]);
  const shown = lines.slice(0, RENDER_CAP_LINES);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail.diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: nothing to do */
    }
  };
  return (
    <div className="bf-term cp-diff">
      <div className="bf-termbar">
        <span className="who">{detail.shortSha}</span>
        <span>
          {detail.files.length} file{detail.files.length === 1 ? '' : 's'}
        </span>
        <span className="add">+{detail.additions}</span>
        <span className="del">−{detail.deletions}</span>
        {detail.truncated && <span className="cp-badge">truncated at 200 KB</span>}
        <button type="button" className="cp-copy r" onClick={copy} aria-label="Copy diff">
          {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}{' '}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {detail.body && (
        <div className="cp-diff-body" style={{ maxHeight: 'none', paddingBottom: 0 }}>
          <div className="m" style={{ whiteSpace: 'pre-wrap', minWidth: 0 }}>
            {detail.body}
          </div>
        </div>
      )}
      {detail.diff.trim() === '' ? (
        <div className="cp-diff-empty">No file changes in this commit.</div>
      ) : (
        <pre className="cp-diff-body">
          {shown.map((line, i) => (
            <div key={i} className={classifyDiffLine(line)}>
              {line === '' ? ' ' : line}
            </div>
          ))}
          {lines.length > shown.length && (
            <div className="cut">… {lines.length - shown.length} more lines not shown</div>
          )}
        </pre>
      )}
    </div>
  );
}
