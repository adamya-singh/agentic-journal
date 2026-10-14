'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { formatPeriodRange, formatShortDate, weeksInclusive } from '@/lib/compass/dates';
import type { CompassDraft, PeriodDetail } from '@/lib/compass/types';
import { CompassMarkdown } from './CompassMarkdown';
import { ProblemsNote } from './CompassSections';
import type { SheetTarget } from './PeriodTimeline';

type Tab = 'compass' | 'log' | 'retro';

interface Props {
  target: SheetTarget | null;
  onClose: () => void;
  /** undefined while loading; null when the period was not found. */
  period: PeriodDetail | null | undefined;
  draft: CompassDraft | null;
  error: string | null;
  today: string;
  /** Where to portal: an element inside the page so the serif font variable is inherited. */
  container?: HTMLElement | null;
}

export function PeriodSheet({ target, onClose, period, draft, error, today, container }: Props) {
  const [tab, setTab] = React.useState<Tab>('compass');
  React.useEffect(() => {
    setTab('compass');
  }, [target?.id, target?.kind]);

  const isDraft = target?.kind === 'draft';
  const summary = period?.summary ?? null;
  const start = isDraft ? draft?.start : summary?.start;
  const end = isDraft ? draft?.end : summary?.end;
  const title = isDraft ? draft?.title : summary?.title;
  const weeks = start && end ? weeksInclusive(start, end) : null;

  const tabs: { key: Tab; label: string; disabled: boolean; hint: string }[] = isDraft
    ? [{ key: 'compass', label: 'Proposal', disabled: false, hint: '' }]
    : [
        {
          key: 'compass',
          label: 'Compass',
          disabled: !period?.compass,
          hint: period?.compass ? '' : 'No snapshot was written for this period',
        },
        {
          key: 'log',
          label: 'Log',
          disabled: !period?.log,
          hint: period?.log ? '' : 'No log.md yet',
        },
        {
          key: 'retro',
          label: 'Retro',
          disabled: !period?.retro,
          hint: period?.retro ? '' : 'No retro yet',
        },
      ];
  const active = tabs.find((t) => t.key === tab && !t.disabled)?.key ?? tabs.find((t) => !t.disabled)?.key;

  return (
    <Dialog.Root
      open={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className="cp-scrim" />
        <Dialog.Content className="bf-root cp-root cp-sheet" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">
            {isDraft ? 'Draft compass' : 'Period'} {target?.id}
          </Dialog.Title>
          <div className="bf-sky">
            <div className="bf-sun" aria-hidden="true" />
            <div className="bf-skytop">
              <div>
                <div className="bf-eyebrow">
                  {isDraft ? 'Draft' : 'Period'} · {target?.id}
                </div>
                <h2 className="bf-title">{title ?? (period === undefined && !isDraft ? 'Loading…' : target?.id)}</h2>
                <div className="cp-dates">
                  {start && end && <b>{formatPeriodRange(start, end)}</b>}
                  {weeks !== null && <span>· {Number.isInteger(weeks) ? weeks : weeks.toFixed(1)} weeks</span>}
                  {!isDraft && summary && (
                    <span className="cp-pill" data-status={summary.state === 'current' ? 'active' : summary.state === 'closed' ? 'closed' : 'expired'}>
                      {summary.state}
                    </span>
                  )}
                  {isDraft && draft && (
                    <span className="cp-pill" data-status={draft.approved ? 'active' : 'upcoming'}>
                      {draft.approved ? 'Approved' : 'Awaiting approval'}
                    </span>
                  )}
                </div>
              </div>
              <Dialog.Close className="bf-x" aria-label="Close">
                <X size={16} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="bf-seg" role="tablist" aria-label="Period files">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active === t.key}
                  disabled={t.disabled}
                  title={t.hint || undefined}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="cp-sheet-body">
            {error && <p className="bf-status err">{error}</p>}
            {isDraft ? (
              draft ? (
                <>
                  <div className={`cp-callout${draft.approved ? '' : ' muted'}`}>
                    <small>{draft.approved ? 'Approved' : 'Proposal'}</small>
                    <b>
                      {draft.approved
                        ? `Approved${draft.approvedBy ? ` by ${draft.approvedBy}` : ''} on ${formatShortDate(draft.approved, true)}${
                            draft.start && today < draft.start ? `, opens ${formatShortDate(draft.start, true)}` : ', opens at the next Pulse run'
                          }`
                        : 'Awaiting your approval on Telegram'}
                    </b>
                    {!draft.approved && (
                      <span className="cp-note">
                        Reply “approve compass” to OpenClaw, or tell it what to change. Nothing opens until you do.
                      </span>
                    )}
                  </div>
                  <ProblemsNote problems={draft.problems} />
                  <CompassMarkdown markdown={draft.text} />
                </>
              ) : (
                <p className="cp-note">This draft is no longer in the repo.</p>
              )
            ) : period === undefined ? (
              <p className="cp-note">Reading the period…</p>
            ) : period === null ? (
              <p className="cp-note">This period is not in the repo any more.</p>
            ) : active === 'compass' && period.compass ? (
              <>
                <div className="cp-note">
                  {period.compass.source === 'snapshot'
                    ? `Final snapshot${period.compass.version !== null ? ` · v${period.compass.version}` : ''}${
                        period.compass.closed ? ` · closed ${formatShortDate(period.compass.closed, true)}` : ''
                      }`
                    : 'The live compass: this period is still open, so no snapshot has been written yet.'}
                </div>
                <ProblemsNote problems={period.compass.problems} />
                <CompassMarkdown markdown={period.compass.text} />
              </>
            ) : active === 'log' && period.log ? (
              period.log.entries.length ? (
                period.log.entries.map((entry, i) => (
                  <article className="cp-log-entry" key={`${entry.date}-${i}`}>
                    <div className="top">
                      {entry.date && <b>{formatShortDate(entry.date, true)}</b>}
                      {entry.kind !== 'other' && (
                        <span className="cp-kind" data-kind={entry.kind}>
                          {entry.kind}
                        </span>
                      )}
                      {entry.title && <span className="ttl">{entry.title}</span>}
                    </div>
                    {entry.body && <CompassMarkdown markdown={entry.body} />}
                  </article>
                ))
              ) : (
                <p className="cp-note">The log has no entries yet.</p>
              )
            ) : active === 'retro' && period.retro ? (
              <>
                <div className="cp-callout">
                  <small>Period-length verdict</small>
                  <b>{period.retro.verdict ?? 'not recorded'}</b>
                  {period.retro.closed && (
                    <span className="cp-note">closed {formatShortDate(period.retro.closed, true)}</span>
                  )}
                </div>
                <CompassMarkdown markdown={period.retro.text} />
              </>
            ) : (
              <p className="cp-note">Nothing has been written for this period yet.</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
