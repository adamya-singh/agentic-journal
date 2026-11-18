'use client';

import React from 'react';
import { CANDIDATE_FACT_CHOICES, CANDIDATE_FACT_KEYS, type CandidateFacts } from '@/lib/candidate-facts';

type Draft = Omit<CandidateFacts, 'confirmedAt'>;

/**
 * What Adamya confirmed once about eligibility. A drafted answer that agrees with these is sent
 * with the other drafts; one that contradicts them waits for him.
 */
export function StandingFacts() {
  const [facts, setFacts] = React.useState<CandidateFacts | null | undefined>(undefined);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; bad?: boolean } | null>(null);

  React.useEffect(() => {
    fetch('/api/jobs/applications/candidate-facts', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error);
        setFacts(data.facts);
        if (data.facts) setDraft(data.facts);
      })
      .catch(() => setNote({ text: 'Could not load your standing facts.', bad: true }));
  }, []);

  const changed = Boolean(draft && facts && (['earliestStart', ...CANDIDATE_FACT_KEYS] as (keyof Draft)[]).some((key) => draft[key] !== facts[key]));

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch('/api/jobs/applications/candidate-facts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save');
      setFacts(data.facts);
      setDraft(data.facts);
      setNote({ text: 'Saved. Drafted answers are checked against these from now on.' });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Could not save', bad: true });
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

  return (
    <section className="mt-1 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Standing facts</h3>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Eligibility answers OpenClaw drafts are sent without your Confirm when they agree with these. One that contradicts a fact waits for you.
      </p>
      {facts === undefined && !note && <p className="mt-2 text-sm text-slate-400">Loading…</p>}
      {facts === null && (
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">
          Not confirmed yet, so every drafted eligibility answer waits for your Confirm.
        </p>
      )}
      {draft && (
        <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {CANDIDATE_FACT_KEYS.map((key) => (
            <label key={key} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              {CANDIDATE_FACT_CHOICES[key].label}
              <select
                className={field}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value } as Draft)}
              >
                {Object.entries(CANDIDATE_FACT_CHOICES[key].choices).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Earliest full-time start
            <input
              type="month"
              className={field}
              value={draft.earliestStart}
              onChange={(event) => setDraft({ ...draft, earliestStart: event.target.value })}
            />
          </label>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {facts && <span className="text-slate-500">Confirmed {new Date(facts.confirmedAt).toLocaleDateString()}</span>}
        {note && <span role="status" className={note.bad ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}>{note.text}</span>}
        {changed && (
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="ml-auto rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Confirm changes'}
          </button>
        )}
      </div>
    </section>
  );
}
