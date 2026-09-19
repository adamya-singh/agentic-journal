'use client';

import React from 'react';
import { Check, MessageCircleQuestion } from 'lucide-react';
import type { JobApplicationAnswer, JobApplicationsViewData } from '@/lib/types';

export function ApplicationReviewPanel({
  applications,
  onResolve,
}: {
  applications: JobApplicationsViewData | null;
  onResolve?: (reviewId: string, action: 'confirm' | 'correct', answer?: JobApplicationAnswer) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [answer, setAnswer] = React.useState('');
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const items = (applications?.reviewItems ?? []).filter((item) => item.status === 'pending');
  if (items.length === 0) return null;

  const resolve = async (id: string, action: 'confirm' | 'correct') => {
    if (!onResolve || pending) return;
    setPending(id);
    setError(null);
    try {
      await onResolve(id, action, action === 'correct' ? answer : undefined);
      setEditing(null);
      setAnswer('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save review. Please try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="border-b border-violet-200 bg-violet-50/50 px-5 py-4 dark:border-violet-900/60 dark:bg-violet-950/10">
      <div className="mb-3 flex items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-violet-600" />
        <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-200">Review OpenClaw’s personal-information choices ({items.length})</h3>
      </div>
      <div className="space-y-3">
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {items.map((item) => (
          <article key={item.id} className="rounded-md border border-violet-200 bg-white p-3 text-sm dark:border-violet-800 dark:bg-slate-900">
            <div className="text-xs font-semibold text-slate-500">{item.company} · {item.role}{item.submittedAt ? ` · submitted ${new Date(item.submittedAt).toLocaleDateString()}` : ''}</div>
            <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{item.question}</p>
            <p className="mt-1 text-slate-700 dark:text-slate-300">Used: {Array.isArray(item.answerUsed) ? item.answerUsed.join(', ') : item.answerUsed}</p>
            <p className="mt-1 text-violet-800 dark:text-violet-300">{item.clarificationPrompt}</p>
            <p className="mt-1 text-xs text-slate-400">Confidence {Math.round(item.confidence * 100)}%</p>
            {editing === item.id ? (
              <div className="mt-2 flex gap-2">
                <input value={answer} onChange={(event) => setAnswer(event.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-950" autoFocus />
                <button disabled={!answer.trim() || pending === item.id} onClick={() => resolve(item.id, 'correct')} className="rounded bg-violet-600 px-3 py-1 font-semibold text-white disabled:opacity-50">Save correction</button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button disabled={!onResolve || pending === item.id} onClick={() => resolve(item.id, 'confirm')} className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 font-semibold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Confirm</button>
                <button disabled={!onResolve || pending === item.id} onClick={() => { setEditing(item.id); setAnswer(Array.isArray(item.answerUsed) ? item.answerUsed.join(', ') : item.answerUsed); }} className="rounded border border-violet-300 px-3 py-1 font-semibold text-violet-700 dark:text-violet-300">Correct</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
