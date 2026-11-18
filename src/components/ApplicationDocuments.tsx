'use client';

import React from 'react';
import { FileText, Loader2, Upload } from 'lucide-react';
import type { JobApplicationDocuments } from '@/lib/types';

/**
 * Files given once for every application: today, the unofficial transcript. Lives at the top of
 * Saved answers because it is the same idea, an answer OpenClaw should never have to ask for twice.
 */
export function ApplicationDocuments() {
  const [documents, setDocuments] = React.useState<JobApplicationDocuments | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetch('/api/jobs/applications/documents', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => { if (data.success) setDocuments(data.documents); })
      .catch(() => setNote({ text: 'Could not load your documents.', bad: true }));
  }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setNote(null);
    try {
      const body = new FormData();
      body.set('kind', 'transcript');
      body.set('file', file);
      const response = await fetch('/api/jobs/applications/documents', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save the transcript');
      setDocuments(data.documents);
      const released: number = data.released?.length ?? 0;
      setNote({
        text: released > 0
          ? `Saved. ${released} waiting application${released === 1 ? '' : 's'} went back to OpenClaw with it.`
          : 'Saved.',
      });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Could not save the transcript', bad: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const transcript = documents?.transcript;
  const [uploadId, fileName] = transcript ? transcript.answer.slice('file:'.length).split('/') : [];

  return (
    <section className="mt-1 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Documents</h3>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Uploaded to every application that asks for one, so none of them stops to ask you.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="font-medium text-slate-800 dark:text-slate-100">Unofficial transcript</span>
        {documents === null ? (
          <span className="text-slate-400">Loading…</span>
        ) : transcript ? (
          <>
            <a
              href={`/api/jobs/applications/files/${uploadId}/${encodeURIComponent(fileName)}`}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 hover:underline dark:text-indigo-300"
            >
              {transcript.fileName}
            </a>
            <span className="text-slate-500">saved {new Date(transcript.savedAt).toLocaleDateString()}</span>
          </>
        ) : (
          <span className="text-amber-600 dark:text-amber-300">Not saved yet. Applications that need it wait for you.</span>
        )}
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}
        />
        <button
          type="button"
          disabled={busy || documents === null}
          onClick={() => input.current?.click()}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {transcript ? 'Replace' : 'Upload PDF'}
        </button>
      </div>
      {note && (
        <p role="status" className={`mt-1 text-xs ${note.bad ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
          {note.text}
        </p>
      )}
    </section>
  );
}
