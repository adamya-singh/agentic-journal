'use client';

import React from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { claudeCodePrompt } from '@/lib/bugs-features/prompt';
import type { BugFeatureStatus, BugFeatureView } from '@/lib/bugs-features/types';
import { BugFeatureCard } from './BugFeatureCard';
import type { Draft, DrawerTab } from './BugsFeaturesProvider';
import { Sunrise } from './icons';

type Filter = 'open' | 'shipped' | 'all';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  onAddFiles: (files: File[]) => number;
  onRemoveImage: (key: string) => void;
  onCancelEdit: () => void;
  onSave: (andCopy: boolean) => void;
  saving: boolean;
  saveError: string | null;
  items: BugFeatureView[];
  loadError: string | null;
  freshId: string | null;
  onCopy: (item: BugFeatureView) => void;
  onEdit: (item: BugFeatureView) => void;
  onStatus: (item: BugFeatureView, status: BugFeatureStatus) => void;
  onDelete: (item: BugFeatureView) => void;
  onZoom: (url: string) => void;
}

export function BugsFeaturesDrawer(props: DrawerProps) {
  const { open, onClose, tab, onTab, items } = props;
  const openCount = items.filter((item) => item.status === 'open').length;
  const shippedCount = items.length - openCount;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="bf-scrim"
            className="bf-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.aside
            key="bf-drawer"
            className="bf-root bf-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bf-drawer-title"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 28 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="bf-sky">
              <div className="bf-sun" aria-hidden="true" />
              <div className="bf-skytop">
                <div>
                  <div className="bf-eyebrow">For Claude Code</div>
                  <h2 className="bf-title" id="bf-drawer-title">
                    Bugs <em>&amp;</em> features
                  </h2>
                </div>
                <div className="bf-tally">
                  <b>{openCount}</b> open
                  <br />
                  <b>{shippedCount}</b> shipped
                </div>
                <button type="button" className="bf-x" onClick={onClose} aria-label="Close (Esc)">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="bf-seg" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'new'}
                  onClick={() => onTab('new')}
                >
                  {props.draft.editingId ? 'Edit' : 'New'}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'saved'}
                  onClick={() => onTab('saved')}
                >
                  Saved<span className="bf-c">{openCount}</span>
                </button>
              </div>
            </div>
            {tab === 'new' ? <NewForm {...props} /> : <SavedList {...props} onClose={onClose} />}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function NewForm({
  draft,
  onDraft,
  onAddFiles,
  onRemoveImage,
  onCancelEdit,
  onSave,
  saving,
  saveError,
  onZoom,
}: DrawerProps) {
  const [hot, setHot] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const words = draft.prompt.trim() ? draft.prompt.trim().split(/\s+/).length : 0;
  const preview = claudeCodePrompt({
    ...draft,
    createdAt: new Date().toISOString(),
    imagePaths: draft.images.map((image, i) =>
      image.name
        ? `(saved screenshot ${i + 1})`
        : `(screenshot ${i + 1}: path added when you save)`,
    ),
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSave(false);
    }
  };

  return (
    <>
      <div className="bf-body" onKeyDown={onKeyDown}>
        <div className="bf-meta">
          <div className="bf-kinds" role="group" aria-label="Kind">
            {(['bug', 'feature'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                data-kind={kind}
                aria-pressed={draft.kind === kind}
                onClick={() => onDraft({ kind })}
              >
                <i />
                {kind === 'bug' ? 'Bug' : 'Feature'}
              </button>
            ))}
          </div>
          {draft.page && (
            <span className="bf-ctx" title="Attached so Claude Code knows where you were">
              from <b>{draft.page}</b>
              <button
                type="button"
                onClick={() => onDraft({ page: null })}
                aria-label="Don't attach the page"
              >
                ×
              </button>
            </span>
          )}
        </div>

        <div
          className={`bf-field bf-drop${hot ? ' hot' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault();
            setHot(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHot(false);
            onAddFiles([...e.dataTransfer.files]);
          }}
        >
          <div className="bf-label">
            <span className="bf-h">Screenshots</span>
            <small>{draft.images.length ? `${draft.images.length} attached` : 'none yet'}</small>
            <small className="r">Ctrl+V pastes</small>
          </div>
          <div className={`bf-shots${draft.images.length ? '' : ' empty'}`}>
            {draft.images.map((image, i) => (
              <div className="bf-shot" key={image.key}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={`Screenshot ${i + 1}`}
                  onClick={() => onZoom(image.url)}
                />
                <span className="num">{i + 1}</span>
                <button
                  type="button"
                  className="rm"
                  onClick={() => onRemoveImage(image.key)}
                  aria-label={`Remove screenshot ${i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="bf-add" onClick={() => fileInput.current?.click()}>
              <Sunrise />
              {draft.images.length ? (
                <span>
                  <b>Ctrl+V</b> or drop
                </span>
              ) : (
                <span>
                  <b>Ctrl+V</b> to paste a screenshot, drop one here, or click to browse
                </span>
              )}
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              onAddFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>

        <div className="bf-field">
          <label className="bf-label" htmlFor="bf-description">
            <span className="bf-h">What happened</span>
            <small>or what you wish it did</small>
          </label>
          <textarea
            id="bf-description"
            rows={4}
            autoFocus
            placeholder="Describe the bug or feature in your own words"
            value={draft.description}
            onChange={(e) => onDraft({ description: e.target.value })}
          />
        </div>

        <div className="bf-field">
          <label className="bf-label" htmlFor="bf-prompt">
            <span className="bf-h">Prompt</span>
            <small>your draft for Claude Code</small>
          </label>
          <div className="bf-term">
            <div className="bf-termbar">
              <span className="who">claude</span>
              <span>~/projects/agentic-journal</span>
              <span className="r">
                {words} word{words === 1 ? '' : 's'}
              </span>
            </div>
            <textarea
              id="bf-prompt"
              rows={5}
              placeholder="Tell Claude Code what to do. The screenshots and description get attached for you."
              value={draft.prompt}
              onChange={(e) => onDraft({ prompt: e.target.value })}
            />
          </div>
        </div>

        <details className="bf-pv">
          <summary>
            <span className="bf-h">What Claude Code receives</span>
            <small>click to preview</small>
          </summary>
          <pre className="bf-pre">{preview}</pre>
        </details>
      </div>

      <div className="bf-foot">
        {saveError ? (
          <span className="bf-status err" role="alert">
            {saveError}
          </span>
        ) : draft.editingId ? (
          <span className="bf-status">
            Editing a saved {draft.kind}
            <button type="button" className="bf-link" onClick={onCancelEdit}>
              cancel
            </button>
          </span>
        ) : (
          <span className="bf-status">Draft kept if you close this</span>
        )}
        <button type="button" className="bf-btn" disabled={saving} onClick={() => onSave(true)}>
          Save and copy
        </button>
        <button
          type="button"
          className="bf-btn rise"
          disabled={saving}
          onClick={() => onSave(false)}
        >
          {saving ? 'Saving…' : 'Save'} <span className="bf-k">Ctrl+Enter</span>
        </button>
      </div>
    </>
  );
}

function SavedList({
  items,
  loadError,
  freshId,
  onCopy,
  onEdit,
  onStatus,
  onDelete,
  onZoom,
  onTab,
  onClose,
}: DrawerProps) {
  const [filter, setFilter] = React.useState<Filter>('open');
  const shown = items.filter((item) => filter === 'all' || item.status === filter);

  return (
    <div className="bf-body">
      <div className="bf-meta">
        <div className="bf-filters" role="group" aria-label="Filter">
          {(['open', 'shipped', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'open' ? 'Open' : f === 'shipped' ? 'Shipped' : 'All'}
            </button>
          ))}
        </div>
        <Link
          href="/bugs-features"
          className="bf-btn small ghost"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
        >
          Open full page →
        </Link>
      </div>
      {loadError && <p className="bf-status err">{loadError}</p>}
      {shown.length === 0 ? (
        <div className="bf-empty">
          <Sunrise />
          <div className="bf-h">{filter === 'shipped' ? 'Nothing shipped yet' : 'Clear skies'}</div>
          <div>
            {filter === 'shipped' ? (
              'Mark one shipped once Claude Code lands it.'
            ) : (
              <>
                Nothing open.{' '}
                <button type="button" className="bf-link" onClick={() => onTab('new')}>
                  Save a bug or feature
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="bf-cards">
          {shown.map((item) => (
            <BugFeatureCard
              key={item.id}
              item={item}
              fresh={item.id === freshId}
              onCopy={onCopy}
              onEdit={onEdit}
              onStatus={onStatus}
              onDelete={onDelete}
              onZoom={onZoom}
            />
          ))}
        </div>
      )}
    </div>
  );
}
