'use client';

import React from 'react';
import { Sunrise } from '@/components/bugs-features/icons';
import { relativeTime } from '@/lib/compass/dates';
import { splitCommitSubject } from '@/lib/compass/markdown-sections';
import type { CommitDetail, CompassCommit, CompassHistory, HistoryScope, RepoInfo } from '@/lib/compass/types';
import { formatEastern } from '@/lib/job-overview-view';
import { DiffView } from './DiffView';

export type DetailState = CommitDetail | 'loading' | 'error';

const AUTHOR_LABEL: Record<CompassCommit['authorKind'], string | null> = {
  openclaw: 'OpenClaw',
  adamya: 'Adamya',
  'compass-sync': 'compass-sync',
  other: null,
};

interface Props {
  history: CompassHistory | undefined;
  loading: boolean;
  scope: HistoryScope;
  onScope: (scope: HistoryScope) => void;
  canMore: boolean;
  onMore: () => void;
  expanded: string | null;
  onToggle: (sha: string) => void;
  details: Record<string, DetailState>;
  repo: RepoInfo | undefined;
  now: number;
}

export function ChangeLog({
  history,
  loading,
  scope,
  onScope,
  canMore,
  onMore,
  expanded,
  onToggle,
  details,
  repo,
  now,
}: Props) {
  const commits = history?.commits ?? [];
  let empty: React.ReactNode = null;
  if (repo && !repo.gitAvailable) {
    empty = (
      <div className="bf-empty">
        <Sunrise />
        <div className="bf-h">git is not installed</div>
        <div>
          The compass history is its git log. Install git (<code>sudo apt install git</code>) and refresh.
        </div>
      </div>
    );
  } else if (repo && !repo.isRepo) {
    empty = (
      <div className="bf-empty">
        <Sunrise />
        <div className="bf-h">No git history</div>
        <div>{repo.error ?? 'The compass directory is not a git repository.'}</div>
      </div>
    );
  } else if (history && !loading && commits.length === 0) {
    empty = (
      <div className="bf-empty">
        <Sunrise />
        <div className="bf-h">No commits yet</div>
        <div>
          {history.error ?? `OpenClaw’s first compass(${scope === 'all' ? '…' : scope}) commit will show here.`}
        </div>
      </div>
    );
  }

  return (
    <section className="cp-sec cp-log" aria-labelledby="cp-changes">
      <div className="cp-log-head">
        <div className="cp-sec-head">
          <h3 className="bf-h" id="cp-changes">
            Changes
          </h3>
          <small>
            {loading && !history ? 'reading git log' : `${commits.length} commit${commits.length === 1 ? '' : 's'}`}
            {repo?.branch ? ` · ${repo.branch}` : ''}
          </small>
        </div>
        <div className="bf-filters" role="group" aria-label="History scope">
          {(['short', 'long', 'all'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => onScope(s)}>
              {s === 'short' ? 'Short' : s === 'long' ? 'Long' : 'All'}
            </button>
          ))}
        </div>
      </div>
      {history?.error && commits.length > 0 && <p className="bf-status err">{history.error}</p>}
      {empty ?? (
        <div className="cp-commits">
          {commits.map((c) => {
            const { subject } = splitCommitSubject(c.subject);
            const open = expanded === c.sha;
            const detail = details[c.sha];
            return (
              <div className="cp-commit" key={c.sha}>
                <button
                  type="button"
                  className="cp-commit-row"
                  aria-expanded={open}
                  onClick={() => onToggle(c.sha)}
                >
                  <div className="cp-commit-meta">
                    <span className="cp-author" data-kind={c.authorKind}>
                      {AUTHOR_LABEL[c.authorKind] ?? c.author}
                    </span>
                    {c.kind !== 'other' && (
                      <span className="cp-kind" data-kind={c.kind}>
                        {c.kind}
                      </span>
                    )}
                  </div>
                  <div className="cp-subject">{subject || c.subject}</div>
                  <div className="cp-when" title={formatEastern(c.date)}>
                    {relativeTime(c.date, now)}
                    <code>{c.shortSha}</code>
                  </div>
                </button>
                {open && (
                  <div className="cp-commit-body">
                    {detail === undefined || detail === 'loading' ? (
                      <p className="cp-note">Reading the diff…</p>
                    ) : detail === 'error' ? (
                      <p className="bf-status err">The diff could not be loaded.</p>
                    ) : (
                      <DiffView detail={detail} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canMore && !empty && (
        <button type="button" className="bf-btn small cp-more" onClick={onMore} disabled={loading}>
          Show more
        </button>
      )}
    </section>
  );
}
