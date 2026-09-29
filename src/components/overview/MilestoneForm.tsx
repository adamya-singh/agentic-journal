'use client';

import React from 'react';
import { X } from 'lucide-react';
import { easternInput, easternIso, milestoneKinds, type Milestone } from '@/lib/job-overview';
import { MILESTONE_LABELS, formatEastern } from '@/lib/job-overview-view';
import type { MilestoneInput } from '@/lib/useOverviewData';
import { Button, Field, InfoTip, Select, TextInput } from './primitives';

/**
 * Records what happened on the employer side that no email can tell us:
 * an assessment you completed, an interview you scheduled, a withdrawal.
 * The time defaults to now but is always editable, because the event usually
 * happened before you sat down to record it. Corrections append rather than
 * overwrite, so the banner names what is being corrected.
 */
export function MilestoneForm({
  listingId,
  initialKind,
  correcting,
  onCancelCorrection,
  onSubmit,
}: {
  listingId: string;
  initialKind?: Milestone['kind'];
  correcting: Milestone | null;
  onCancelCorrection: () => void;
  onSubmit: (input: MilestoneInput) => Promise<void>;
}) {
  const [kind, setKind] = React.useState<Milestone['kind']>(
    correcting?.kind ?? initialKind ?? 'assessment-completed',
  );
  const [when, setWhen] = React.useState(() =>
    easternInput(correcting?.occurredAt ?? new Date().toISOString()),
  );
  const [note, setNote] = React.useState(correcting?.note ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const kindRef = React.useRef<HTMLSelectElement>(null);
  React.useEffect(() => {
    if (initialKind || correcting) kindRef.current?.focus();
  }, [initialKind, correcting]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    let occurredAt: string;
    try {
      occurredAt = easternIso(when);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enter a valid Eastern date and time');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        listingId,
        kind,
        occurredAt,
        note: note.trim(),
        ...(correcting ? { supersedes: correcting.id } : {}),
      });
      setNote('');
      if (correcting) onCancelCorrection();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the milestone');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"
      aria-label={correcting ? 'Correct milestone' : 'Record milestone'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
          {correcting ? 'Correct a milestone' : 'Record a milestone'}
        </h3>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          Times are Eastern
          <InfoTip label="About milestone times">
            Enter the wall-clock time in New York. During the repeated hour when clocks fall back,
            the earlier (EDT) occurrence is used; a time that never existed when clocks sprang
            forward is rejected. Completed milestones cannot be in the future; only a scheduled
            interview can.
          </InfoTip>
        </span>
      </div>
      {correcting && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <span>
            Correcting <strong>{MILESTONE_LABELS[correcting.kind]}</strong> ·{' '}
            {formatEastern(correcting.occurredAt)}. The original stays in the history.
          </span>
          <button
            type="button"
            onClick={onCancelCorrection}
            className="ml-auto inline-flex min-h-7 items-center gap-1 rounded px-2 font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            <X className="h-3 w-3" aria-hidden="true" /> Cancel
          </button>
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(11rem,1.4fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <Field label="Milestone">
          <Select ref={kindRef} value={kind} onChange={(e) => setKind(e.target.value as Milestone['kind'])}>
            {milestoneKinds.map((k) => (
              <option key={k} value={k}>
                {MILESTONE_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="When">
          <TextInput
            required
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Note (optional)">
          <TextInput
            maxLength={500}
            value={note}
            placeholder="e.g. HackerRank, 90 minutes"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : correcting ? 'Save correction' : 'Add milestone'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
