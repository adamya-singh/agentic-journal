'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, X } from 'lucide-react';
import { feedApi } from './feed/api';
import { ACQUISITION_LABELS } from '@/lib/media/acquisition-types';
import type { AcquisitionView } from '@/lib/media/acquisition-view';

export function KeepOnDisk({
  id,
  selected = false,
  onChanged,
}: {
  id: string;
  selected?: boolean;
  onChanged?: () => void;
}) {
  const [options, setOptions] = useState<{
    title: string;
    kind: string;
    seasons: number[];
    selected: number[];
  }>();
  const [seasons, setSeasons] = useState<number[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const save = async (chosen?: number[]) => {
    setBusy(true);
    setError('');
    try {
      await feedApi('acquisition/request', { id, seasons: chosen });
      setOptions(undefined);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    setBusy(true);
    setError('');
    try {
      const o = await feedApi<NonNullable<typeof options>>('acquisition/prepare', { id });
      if (o.kind === 'film') await save();
      else {
        setOptions(o);
        setSeasons(o.selected);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await feedApi('acquisition/cancel', { id });
      setOptions(undefined);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        aria-pressed={selected}
        title={selected ? 'Manage kept seasons or stop monitoring' : 'Keep on disk'}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs hover:bg-sky-100 dark:hover:bg-sky-950 ${selected ? 'text-sky-600' : 'text-gray-500'}`}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}{' '}
        {selected ? 'Keep settings' : 'Keep on disk'}
      </button>
      {selected && !options && (
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy}
          className="px-2 text-xs text-gray-500"
        >
          Stop keeping
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {options && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Keep ${options.title} on disk`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setOptions(undefined)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 text-gray-900 dark:bg-gray-900 dark:text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold">Keep {options.title} on disk</h2>
              <button
                type="button"
                aria-label="Close season picker"
                onClick={() => setOptions(undefined)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="my-3 text-sm text-gray-500">
              Choose seasons. New episodes in these seasons will be added automatically. Future
              seasons are a separate choice.
            </p>
            <div className="max-h-72 overflow-auto space-y-2">
              {options.seasons.map((n) => (
                <label
                  key={n}
                  className="flex gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={seasons.includes(n)}
                    onChange={(e) =>
                      setSeasons((s) => (e.target.checked ? [...s, n] : s.filter((v) => v !== n)))
                    }
                  />
                  {n === 0 ? 'Specials' : `Season ${n}`}
                </label>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-between gap-3">
              {selected && (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  disabled={busy}
                  className="text-sm text-gray-500"
                >
                  Stop monitoring; keep files
                </button>
              )}
              <button
                type="button"
                disabled={busy || !seasons.length}
                onClick={() => void save(seasons)}
                className="ml-auto rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Save seasons
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
const giB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
export function MediaDownloads({ onChange }: { onChange?: (view: AcquisitionView) => void }) {
  const [view, setView] = useState<AcquisitionView>(),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const v = await feedApi<AcquisitionView>('acquisition');
      setView(v);
      onChange?.(v);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onChange]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);
  if (!view)
    return error ? (
      <p role="alert" className="my-4 text-sm text-red-600">
        {error}
      </p>
    ) : null;
  const requests = Object.values(view.requests).filter((r) => r.wanted || r.items.length);
  return (
    <details className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <summary className="cursor-pointer font-semibold">
        Downloads & streaming{' '}
        <span className="ml-2 text-sm font-normal text-gray-500">
          {view.networkMode === 'direct' ? 'Direct internet · VPN off' : 'Proton VPN'} ·{' '}
          {view.ready ? 'Ready' : 'Setup / attention needed'} · {giB(view.storage.usedBytes)} /{' '}
          {giB(view.storage.budgetBytes)}
        </span>
      </summary>
      <div className="mt-4 space-y-4 text-sm">
        <p>
          {giB(view.storage.freeBytes)} free · {giB(view.storage.reservedBytes)} reserved for
          downloads · original audio, English subtitles
        </p>
        {view.storage.note && (
          <p role="status" className="text-amber-700 dark:text-amber-300">
            {view.storage.note}
          </p>
        )}
        {view.setup.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {view.setup.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {Object.entries(view.services).map(([name, s]) => (
            <span
              key={name}
              title={s.note}
              className={
                s.ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-300'
              }
            >
              {name}: {s.ok ? 'Ready' : s.note || 'Needs setup'}
            </span>
          ))}
        </div>
        <p className="text-gray-500">
          Setup instructions: docs/media-stack.md. Downloads start after network routing and tested
          sources are connected. Unavailable titles remain on your wanted list.
        </p>
        {!!requests.length && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {r.title}{' '}
                    <span className="ml-2 font-normal text-gray-500">
                      {ACQUISITION_LABELS[r.status]}
                      {r.progress !== undefined ? ` · ${Math.round(r.progress * 100)}%` : ''}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {r.kind === 'series'
                      ? r.seasons.length
                        ? `Seasons ${r.seasons.join(', ')}`
                        : 'Choose seasons to begin'
                      : 'Movie'}{' '}
                    · {r.items.length} playable {r.items.length === 1 ? 'item' : 'items'}
                  </p>
                  {r.note && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{r.note}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <KeepOnDisk id={r.id} selected={r.wanted} onChanged={() => void load()} />
                  {r.wanted && (
                    <button
                      type="button"
                      className="text-xs text-sky-600"
                      onClick={() =>
                        void feedApi('acquisition/retry', { id: r.id })
                          .then(load)
                          .catch((e) => setError(e.message))
                      }
                    >
                      Retry search
                    </button>
                  )}
                  {!!r.items.length && (
                    <Link
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white"
                      href={`/media/unwind/watch?id=${r.id}&ep=${r.items[0].key}`}
                    >
                      Play
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {requests.some((r) => r.wanted) && (
          <button
            type="button"
            className="text-sky-600"
            onClick={() =>
              void feedApi('acquisition/bulk', {
                ids: requests
                  .filter((r) => r.wanted)
                  .map((r) => r.id)
                  .slice(0, 100),
              })
                .then(load)
                .catch((e) => setError(e.message))
            }
          >
            Queue selected media
          </button>
        )}
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
