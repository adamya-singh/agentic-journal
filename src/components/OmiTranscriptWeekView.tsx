'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownUp, Loader2, RefreshCw } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';

interface DayInfo {
  date: string;
  dayName: string;
  displayDate: string;
}

interface OmiTranscriptSegment {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  startLabel: string;
  endLabel: string;
  durationSeconds: number | null;
  transcript: string;
  transcriptHash: string;
  journalLink: OmiTranscriptJournalLink;
}

type OmiTranscriptJournalLinkStatus = 'unprocessed' | 'logged' | 'skipped' | 'requested' | 'stale';

interface OmiTranscriptJournalLink {
  status: OmiTranscriptJournalLinkStatus;
  eligible: boolean;
  stale: boolean;
  journalRefs: OmiTranscriptJournalRef[];
  proposalId: string | null;
  runId: string | null;
  skipReason: string | null;
  updatedAt: string | null;
  loggedAt: string | null;
  skippedAt: string | null;
  requestedAt: string | null;
  requestSource: string | null;
}

interface OmiTranscriptJournalRef {
  date: string;
  journalEntryId: string;
  hour?: string;
  range?: {
    start: string;
    end: string;
  };
}

type OmiTranscriptBatchStatus = 'completed' | 'failed' | 'pending' | 'running' | 'missing';

interface OmiTranscriptBatch {
  id: string;
  status: OmiTranscriptBatchStatus;
  startedAt: string | null;
  endedAt: string | null;
  startLabel: string;
  endLabel: string;
  durationSeconds: number | null;
  chunkCount: number;
  transcriptChars: number | null;
  completedAt: string | null;
  failedAt: string | null;
  retryAfter: string | null;
  retryCount: number;
  lastRetryRequestedAt: string | null;
  recoverable: boolean;
  error: string | null;
}

interface OmiTranscriptDay {
  date: string;
  segments: OmiTranscriptSegment[];
  batches: OmiTranscriptBatch[];
  omittedSegmentCount: number;
  status: {
    exists: boolean;
    segmentCount: number;
    transcriptCharCount: number;
    audioChunkCount: number;
    queueChunkCount: number;
    completedBatchCount: number;
    failedBatchCount: number;
    pendingBatchCount: number;
    runningBatchCount: number;
    missingChunkCount: number;
    bufferedChunkCount?: number;
    audioSeconds?: number;
    recoverableBatchCount: number;
    newestAudioAt?: string;
    bufferedSince?: string;
    generatedAt?: string;
    newestTranscriptAt?: string;
    statusUpdatedAt?: string;
    queueUpdatedAt?: string;
  };
}

interface OmiTranscriptResponse {
  success: boolean;
  error?: string;
  dates?: string[];
  transcripts?: Record<string, OmiTranscriptDay>;
}

type FeedOrder = 'newest' | 'oldest';

const DAY_NAMES_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const POLL_INTERVAL_MS = 10_000;
// /api/omi/live only stats a file, so it can be polled often enough to light up right after a connect.
const LIVE_POLL_INTERVAL_MS = 3_000;
// The Omi app streams through silence but can hold audio and flush it in bursts
// (gaps of ~45s, and ~110s on some days), so only call it disconnected after a longer quiet spell.
const CONNECTED_AUDIO_MS = 2 * 60_000;
const DISCONNECTED_AUDIO_MS = 5 * 60_000;
const ORDER_STORAGE_KEY = 'omi-transcripts-order';
const CLAMP_CHARS = 420;

function getWeekDates(offset: number = 0): DayInfo[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday + offset * 7);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return {
      date: `${year}-${month}-${day}`,
      dayName: DAY_NAMES_MON_FIRST[index],
      displayDate: `${month}/${day}`,
    };
  });
}

function getTodayISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDayInfoForOffset(offsetFromToday: number): DayInfo {
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + offsetFromToday);

  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  const jsDay = target.getDay();
  const monIndex = jsDay === 0 ? 6 : jsDay - 1;

  return {
    date: `${year}-${month}-${day}`,
    dayName: DAY_NAMES_MON_FIRST[monIndex],
    displayDate: `${month}/${day}`,
  };
}

function getWeekOffsetForDayOffset(dayOffsetFromToday: number): number {
  const now = new Date();
  const todayJsDay = now.getDay();
  const todayMonIndex = todayJsDay === 0 ? 6 : todayJsDay - 1;
  return Math.floor((todayMonIndex + dayOffsetFromToday) / 7);
}

function getDayOffsetFromToday(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) {
    return 0;
  }
  const target = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) {
    return null;
  }

  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.round(rounded / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatClock(iso: string | null, fallback: string): string {
  if (iso) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }
  return fallback;
}

function formatTimeRange(startedAt: string | null, endedAt: string | null, startLabel: string, endLabel: string): string {
  const start = formatClock(startedAt, startLabel);
  const end = formatClock(endedAt, endLabel);
  return end && end !== start ? `${start} – ${end}` : start;
}

function formatRelative(iso: string | undefined | null, now: number): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function getBatchTimeKey(batch: OmiTranscriptBatch): string {
  return batch.startedAt ?? batch.id;
}

function getSegmentTimeKey(segment: OmiTranscriptSegment): string {
  return segment.startedAt ?? segment.id;
}

function formatBatchStatus(status: OmiTranscriptBatchStatus): string {
  if (status === 'failed') return 'Failed';
  if (status === 'pending') return 'Queued';
  if (status === 'running') return 'Transcribing…';
  if (status === 'completed') return 'Completed';
  return 'Missing';
}

function formatDaySummary(dayTranscript: OmiTranscriptDay | undefined, segmentCount: number): string {
  if (!dayTranscript?.status.exists) {
    return 'No audio';
  }

  const status = dayTranscript.status;
  const parts = [`${segmentCount} transcript${segmentCount === 1 ? '' : 's'}`];
  const audio = formatDuration(status.audioSeconds);
  if (audio) {
    parts.push(`${audio} audio`);
  }
  if (status.failedBatchCount > 0) {
    parts.push(`${status.failedBatchCount} failed`);
  }
  return parts.join(' · ');
}

export function OmiTranscriptWeekView({
  initialDate,
  initialSegmentId,
}: {
  initialDate?: string;
  initialSegmentId?: string;
}) {
  const isMobile = useIsMobile();
  const initialDayOffset = initialDate ? getDayOffsetFromToday(initialDate) : 0;
  const initialWeekOffset = getWeekOffsetForDayOffset(initialDayOffset);
  const [weekOffset, setWeekOffset] = useState(initialWeekOffset);
  const [weekDates, setWeekDates] = useState<DayInfo[]>(() => getWeekDates(initialWeekOffset));
  const [transcripts, setTranscripts] = useState<Record<string, OmiTranscriptDay>>({});
  const [loadedWeekKey, setLoadedWeekKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [liveAudioAt, setLiveAudioAt] = useState<string | null>(null);
  const [order, setOrder] = useState<FeedOrder>('newest');
  const [freshSegmentIds, setFreshSegmentIds] = useState<Set<string>>(() => new Set());
  const [mobileDayOffsetFromToday, setMobileDayOffsetFromToday] = useState(initialDayOffset);
  const [retryingDates, setRetryingDates] = useState<Record<string, boolean>>({});
  const [requestingSegments, setRequestingSegments] = useState<Record<string, boolean>>({});
  const knownSegmentIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const weekRequestRef = useRef(0);
  const scrolledToInitialSegmentRef = useRef(false);

  const weekKey = weekDates[0]?.date ?? '';
  const loading = loadedWeekKey !== weekKey;

  useEffect(() => {
    setWeekDates(getWeekDates(weekOffset));
  }, [weekOffset]);

  useEffect(() => {
    if (!isMobile) return;
    const required = getWeekOffsetForDayOffset(mobileDayOffsetFromToday);
    setWeekOffset((prev) => (prev === required ? prev : required));
  }, [isMobile, mobileDayOffsetFromToday]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ORDER_STORAGE_KEY);
      if (stored === 'newest' || stored === 'oldest') setOrder(stored);
    } catch {
      // Storage can be blocked; the default order still works.
    }
  }, []);

  const toggleOrder = () => {
    const next: FeedOrder = order === 'newest' ? 'oldest' : 'newest';
    setOrder(next);
    try {
      window.localStorage.setItem(ORDER_STORAGE_KEY, next);
    } catch {
      // Ignore blocked storage.
    }
  };

  // Remember which segments each day already had so polled arrivals can be highlighted.
  const absorbDays = useCallback((days: Record<string, OmiTranscriptDay>, markFresh: boolean) => {
    const fresh: string[] = [];
    for (const [date, day] of Object.entries(days)) {
      const known = knownSegmentIdsRef.current.get(date);
      const ids = new Set(day.segments.map((segment) => segment.id));
      if (known && markFresh) {
        for (const id of ids) {
          if (!known.has(id)) fresh.push(id);
        }
      }
      knownSegmentIdsRef.current.set(date, ids);
    }
    setTranscripts((prev) => ({ ...prev, ...days }));
    setLastUpdatedAt(Date.now());
    if (fresh.length > 0) {
      setFreshSegmentIds((prev) => new Set([...prev, ...fresh]));
    }
  }, []);

  const fetchDays = useCallback(async (dates: string[]) => {
    const params = new URLSearchParams();
    for (const date of dates) params.append('dates', date);
    const response = await fetch(`/api/omi/transcripts?${params.toString()}`, { cache: 'no-store' });
    const payload = (await response.json()) as OmiTranscriptResponse;
    if (!response.ok || !payload.success || !payload.transcripts) {
      throw new Error(payload.error || 'Failed to fetch Omi transcripts');
    }
    return payload.transcripts;
  }, []);

  const fetchWeek = useCallback(async () => {
    const requestId = ++weekRequestRef.current;
    // Today rides along so the live status stays correct on past weeks.
    const dates = Array.from(new Set([...weekDates.map((day) => day.date), getTodayISO()]));
    try {
      const days = await fetchDays(dates);
      if (requestId !== weekRequestRef.current) return;
      absorbDays(days, false);
      setError(null);
    } catch (fetchError) {
      if (requestId !== weekRequestRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to connect to server');
    } finally {
      if (requestId === weekRequestRef.current) setLoadedWeekKey(weekDates[0]?.date ?? '');
    }
  }, [absorbDays, fetchDays, weekDates]);

  useEffect(() => {
    fetchWeek();
  }, [fetchWeek]);

  const refreshToday = useCallback(async () => {
    setRefreshing(true);
    try {
      absorbDays(await fetchDays([getTodayISO()]), true);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to connect to server');
    } finally {
      setRefreshing(false);
    }
  }, [absorbDays, fetchDays]);

  const checkLive = useCallback(async () => {
    try {
      const response = await fetch('/api/omi/live', { cache: 'no-store' });
      const payload = (await response.json()) as { success?: boolean; newestAudioAt?: string | null };
      if (response.ok && payload.success) setLiveAudioAt(payload.newestAudioAt ?? null);
    } catch {
      // The full refresh reports connection errors.
    }
  }, []);

  // Poll today's pipeline while the tab is visible, and catch up as soon as it becomes visible again.
  useEffect(() => {
    let timers: number[] = [];
    const start = () => {
      if (timers.length > 0) return;
      timers = [
        window.setInterval(refreshToday, POLL_INTERVAL_MS),
        window.setInterval(checkLive, LIVE_POLL_INTERVAL_MS),
      ];
    };
    const stop = () => {
      timers.forEach((timer) => window.clearInterval(timer));
      timers = [];
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshToday();
        checkLive();
        start();
      } else {
        stop();
      }
    };
    checkLive();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checkLive, refreshToday]);

  useEffect(() => {
    if (freshSegmentIds.size === 0) return;
    const id = window.setTimeout(() => setFreshSegmentIds(new Set()), 8000);
    return () => window.clearTimeout(id);
  }, [freshSegmentIds]);

  useEffect(() => {
    if (loading || !initialSegmentId || scrolledToInitialSegmentRef.current) return;
    const target = document.getElementById(`omi-segment-${initialSegmentId}`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    scrolledToInitialSegmentRef.current = true;
  }, [initialSegmentId, loading, transcripts]);

  const retryTranscriptBatches = useCallback(async (date: string, batchIds?: string[]) => {
    setRetryingDates((prev) => ({ ...prev, [date]: true }));
    setError(null);

    try {
      const response = await fetch('/api/omi/transcripts/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...(batchIds ? { batchIds } : {}) }),
      });
      const payload = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        setError(payload.error || 'Failed to mark Omi transcript batches for retry');
        return;
      }
      absorbDays(await fetchDays([date]), false);
    } catch {
      setError('Failed to connect to server');
    } finally {
      setRetryingDates((prev) => ({ ...prev, [date]: false }));
    }
  }, [absorbDays, fetchDays]);

  const requestJournalProposal = useCallback(async (date: string, segmentId: string) => {
    const key = `${date}:${segmentId}`;
    setRequestingSegments((prev) => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const response = await fetch('/api/omi/transcripts/journal-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, segmentId }),
      });
      const payload = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        setError(payload.error || 'Failed to request Omi journal proposal');
        return;
      }
      absorbDays(await fetchDays([date]), false);
    } catch {
      setError('Failed to connect to server');
    } finally {
      setRequestingSegments((prev) => ({ ...prev, [key]: false }));
    }
  }, [absorbDays, fetchDays]);

  const getWeekTitle = () => {
    if (weekOffset === 0) return 'This Week';
    if (weekOffset === -1) return 'Last Week';
    if (weekOffset === 1) return 'Next Week';
    return `Week of ${weekDates[0]?.displayDate ?? ''}`;
  };

  const todayDate = getTodayISO();
  const gridTemplateColumns = weekDates
    .map((dayInfo) => (dayInfo.date === todayDate ? '1.5fr' : '1fr'))
    .join(' ');
  const mobileDayInfo = getDayInfoForOffset(mobileDayOffsetFromToday);
  const visibleDayInfos: DayInfo[] = isMobile ? [mobileDayInfo] : weekDates;

  const weekHeader = (
    <WeekHeader
      title={getWeekTitle()}
      weekOffset={weekOffset}
      onPrevious={() => setWeekOffset((prev) => prev - 1)}
      onNext={() => setWeekOffset((prev) => prev + 1)}
      onToday={() => setWeekOffset(0)}
    />
  );
  const liveStatus = (
    <LiveStatusBar
      today={transcripts[todayDate]}
      liveAudioAt={liveAudioAt}
      refreshing={refreshing}
      lastUpdatedAt={lastUpdatedAt}
      order={order}
      onToggleOrder={toggleOrder}
      onRefresh={refreshToday}
    />
  );

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        {weekHeader}
        {liveStatus}
        <div className="hidden sm:grid grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-64 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="sm:hidden">
          <div className="h-64 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-2 sm:p-4">
      {weekHeader}

      <div className="sm:hidden flex items-center justify-between gap-2 mb-3 px-1">
        <button
          onClick={() => setMobileDayOffsetFromToday((prev) => prev - 1)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Previous day"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex flex-col items-center min-w-0">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 truncate">
            {mobileDayInfo.dayName} {mobileDayInfo.displayDate}
          </h2>
          {mobileDayOffsetFromToday !== 0 && (
            <button
              onClick={() => setMobileDayOffsetFromToday(0)}
              className="mt-1 px-3 py-0.5 text-xs rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
            >
              Today
            </button>
          )}
        </div>

        <button
          onClick={() => setMobileDayOffsetFromToday((prev) => prev + 1)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Next day"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {liveStatus}

      {error && (
        <p className="mb-3 text-center text-sm text-red-500 dark:text-red-400">{error}</p>
      )}

      <div
        className={isMobile ? 'block' : 'grid gap-3'}
        style={isMobile ? undefined : { gridTemplateColumns }}
      >
        {visibleDayInfos.map((dayInfo) => {
          const dayTranscript = transcripts[dayInfo.date];
          const isToday = dayInfo.date === todayDate;
          const isFuture = dayInfo.date > todayDate;
          const hasFile = dayTranscript?.status.exists === true;
          const segments = dayTranscript?.segments ?? [];
          const batches = dayTranscript?.batches ?? [];
          const incompleteBatches = batches.filter((batch) => batch.status !== 'completed');
          const failedBatchIds = batches
            .filter((batch) => batch.status === 'failed')
            .map((batch) => batch.id);
          const omittedSegmentCount = dayTranscript?.omittedSegmentCount ?? 0;
          const missingChunkCount = dayTranscript?.status.missingChunkCount ?? 0;
          const bufferedChunkCount = isToday ? dayTranscript?.status.bufferedChunkCount ?? 0 : 0;
          const retrying = retryingDates[dayInfo.date] === true;
          const renderItems = [
            ...segments.map((segment) => ({ type: 'segment' as const, key: `segment:${segment.id}`, timeKey: getSegmentTimeKey(segment), segment })),
            ...incompleteBatches.map((batch) => ({ type: 'batch' as const, key: `batch:${batch.id}`, timeKey: getBatchTimeKey(batch), batch })),
          ].sort((a, b) => a.timeKey.localeCompare(b.timeKey));
          if (order === 'newest') renderItems.reverse();
          const listeningCard = bufferedChunkCount > 0 && dayTranscript
            ? <ListeningCard key="listening" day={dayTranscript} />
            : null;

          return (
            <div
              key={dayInfo.date}
              className={`flex flex-col rounded-lg border overflow-hidden ${
                isToday
                  ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-md'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              } ${isFuture ? 'opacity-60' : ''}`}
            >
              <div
                className={`px-3 py-2 text-center border-b ${
                  isToday
                    ? 'bg-indigo-500 dark:bg-indigo-600 text-white border-indigo-400 dark:border-indigo-500'
                    : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{dayInfo.dayName}</span>
                  <span className="text-sm opacity-80">{dayInfo.displayDate}</span>
                </div>
                <div className="mt-1 text-xs opacity-80">
                  {isFuture ? ' ' : formatDaySummary(dayTranscript, segments.length)}
                </div>
              </div>

              <div className={isMobile ? 'flex-1 p-2 min-h-[260px]' : 'flex-1 p-2 min-h-[260px] max-h-[calc(100vh-15rem)] overflow-y-auto'}>
                {hasFile && (failedBatchIds.length > 0 || missingChunkCount > 0) && (
                  <div className="mb-2 space-y-2">
                    {failedBatchIds.length > 0 && (
                      <button
                        onClick={() => retryTranscriptBatches(dayInfo.date, failedBatchIds)}
                        disabled={retrying}
                        className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
                      >
                        {retrying ? 'Marking retry…' : `Retry ${failedBatchIds.length} failed`}
                      </button>
                    )}
                    {missingChunkCount > 0 && (
                      <button
                        onClick={() => retryTranscriptBatches(dayInfo.date)}
                        disabled={retrying}
                        className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
                      >
                        {retrying ? 'Marking retry…' : `Retry ${formatDuration(missingChunkCount) ?? missingChunkCount} untranscribed audio`}
                      </button>
                    )}
                  </div>
                )}

                {renderItems.length > 0 || listeningCard ? (
                  <div className="space-y-2 animate-[weekviewFadeSlide_150ms_ease-out] motion-reduce:animate-none">
                    {order === 'newest' && listeningCard}
                    {renderItems.map((item) => {
                      if (item.type === 'batch') {
                        return <BatchStatusCard key={item.key} batch={item.batch} />;
                      }

                      const segment = item.segment;
                      return (
                        <TranscriptSegmentCard
                          key={item.key}
                          segment={segment}
                          isToday={isToday}
                          isHighlighted={segment.id === initialSegmentId}
                          isFresh={freshSegmentIds.has(segment.id)}
                          date={dayInfo.date}
                          requesting={requestingSegments[`${dayInfo.date}:${segment.id}`] === true}
                          onRequestJournalProposal={requestJournalProposal}
                        />
                      );
                    })}
                    {order === 'oldest' && listeningCard}
                    {omittedSegmentCount > 0 && (
                      <p className="pt-1 text-center text-xs text-gray-400 dark:text-gray-500">
                        {omittedSegmentCount} silent segment{omittedSegmentCount === 1 ? '' : 's'} hidden
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-1 text-center text-gray-400 dark:text-gray-500">
                    <p className="text-sm italic">
                      {isFuture ? '' : isToday ? 'Nothing transcribed yet' : hasFile ? 'No speech' : 'No transcript'}
                    </p>
                    {isToday && !hasFile && (
                      <p className="max-w-[16rem] text-xs">Text shows up about a minute after the Omi hears speech.</p>
                    )}
                    {omittedSegmentCount > 0 && (
                      <p className="text-xs">{omittedSegmentCount} silent segment{omittedSegmentCount === 1 ? '' : 's'} hidden</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style jsx>{`
        @keyframes weekviewFadeSlide {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

type LiveState = 'connected' | 'delayed' | 'disconnected' | 'unknown';

function getLiveState(newestAudioAt: string | null, known: boolean, now: number): LiveState {
  if (!known) return 'unknown';
  const newest = newestAudioAt ? new Date(newestAudioAt).getTime() : NaN;
  if (!Number.isFinite(newest)) return 'disconnected';
  const age = now - newest;
  if (age <= CONNECTED_AUDIO_MS) return 'connected';
  if (age <= DISCONNECTED_AUDIO_MS) return 'delayed';
  return 'disconnected';
}

const LIVE_COPY: Record<LiveState, { label: string; dot: string; pill: string; hint: string }> = {
  connected: {
    label: 'Omi connected',
    dot: 'bg-emerald-500',
    pill: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300',
    hint: 'The Omi app is sending audio to the Journal.',
  },
  delayed: {
    label: 'Audio delayed',
    dot: 'bg-amber-400',
    pill: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300',
    hint: 'No audio for over 2 minutes. The Omi app may be holding audio, or the Omi disconnected.',
  },
  disconnected: {
    label: 'Omi disconnected',
    dot: 'bg-gray-400',
    pill: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
    hint: 'No audio for over 5 minutes. Check that the Omi is paired and the Omi app is open.',
  },
  unknown: {
    label: 'Checking Omi…',
    dot: 'bg-gray-300 dark:bg-gray-600',
    pill: 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
    hint: 'Checking for recent audio.',
  },
};

function LiveStatusBar({
  today,
  liveAudioAt,
  refreshing,
  lastUpdatedAt,
  order,
  onToggleOrder,
  onRefresh,
}: {
  today: OmiTranscriptDay | undefined;
  liveAudioAt: string | null;
  refreshing: boolean;
  lastUpdatedAt: number | null;
  order: FeedOrder;
  onToggleOrder: () => void;
  onRefresh: () => void;
}) {
  const now = useNow(1000);
  const status = today?.status;
  const newestAudioAt = [liveAudioAt, status?.newestAudioAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const state = getLiveState(newestAudioAt, Boolean(today || liveAudioAt), now);
  const copy = LIVE_COPY[state];
  const lastAudio = formatRelative(newestAudioAt, now);
  const lastTranscript = formatRelative(status?.newestTranscriptAt, now);
  const buffered = status?.bufferedChunkCount ?? 0;
  const active = (status?.pendingBatchCount ?? 0) + (status?.runningBatchCount ?? 0);
  const transcribing = active > 0 || buffered > 0;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-4 text-xs sm:text-sm">
      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${copy.pill}`} title={copy.hint} role="status">
        <span className="relative flex h-2.5 w-2.5">
          {state === 'connected' && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${copy.dot}`} />
        </span>
        {copy.label}
        {lastAudio && state !== 'unknown' && (
          <span className="font-normal tabular-nums opacity-80">· last audio {lastAudio}</span>
        )}
      </span>

      {transcribing && (
        <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          {buffered > 0 ? `Transcribing ${formatDuration(buffered) ?? `${buffered}s`} of audio` : 'Transcribing'}
        </span>
      )}

      <span className="text-gray-600 dark:text-gray-400 tabular-nums">
        Last transcript {lastTranscript ?? '—'}
      </span>

      <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
        <button
          type="button"
          onClick={onToggleOrder}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          title="Change sort order"
        >
          <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
          {order === 'newest' ? 'Newest first' : 'Oldest first'}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          title="Updates every 10 seconds. Click to refresh now."
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
          {lastUpdatedAt ? `Updated ${formatRelative(new Date(lastUpdatedAt).toISOString(), now)}` : 'Refresh'}
        </button>
      </span>
    </div>
  );
}

function ListeningCard({ day }: { day: OmiTranscriptDay }) {
  const since = day.status.bufferedSince;
  const buffered = day.status.bufferedChunkCount ?? 0;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-dashed border-indigo-300 bg-white/60 px-3 py-2 text-xs dark:border-indigo-800 dark:bg-gray-900/30">
      <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
        {[60, 100, 45, 80].map((height, bar) => (
          <span
            key={bar}
            className="w-[3px] animate-pulse rounded-full bg-indigo-400 motion-reduce:animate-none"
            style={{ height: `${height}%`, animationDelay: `${bar * 150}ms` }}
          />
        ))}
      </span>
      <span className="min-w-0 text-indigo-700 dark:text-indigo-300">
        <span className="font-medium">Listening{since ? ` since ${formatClock(since, '')}` : ''}</span>
        <span className="opacity-80"> · {formatDuration(buffered) ?? `${buffered}s`} on its way to text</span>
      </span>
    </div>
  );
}

function TranscriptSegmentCard({
  segment,
  isToday,
  isHighlighted,
  isFresh,
  date,
  requesting,
  onRequestJournalProposal,
}: {
  segment: OmiTranscriptSegment;
  isToday: boolean;
  isHighlighted: boolean;
  isFresh: boolean;
  date: string;
  requesting: boolean;
  onRequestJournalProposal: (date: string, segmentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = segment.transcript.length > CLAMP_CHARS;
  const journalRef = segment.journalLink.journalRefs[0];
  const journalHref = journalRef
    ? `/?date=${encodeURIComponent(journalRef.date)}&journalEntry=${encodeURIComponent(journalRef.journalEntryId)}`
    : null;
  const duration = formatDuration(segment.durationSeconds);

  return (
    <article
      id={`omi-segment-${segment.id}`}
      className={`rounded-md border px-3 py-2 transition-colors duration-1000 ${
        isHighlighted
          ? 'border-amber-300 bg-white ring-2 ring-amber-300/70 dark:border-amber-500 dark:bg-gray-900/40 dark:ring-amber-500/60'
          : isFresh
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
            : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/30'
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
        <span title={formatTimeRange(segment.startedAt, segment.endedAt, segment.startLabel, segment.endLabel)}>
          <span className={`whitespace-nowrap font-semibold tabular-nums ${isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-300'}`}>
            {formatClock(segment.startedAt, segment.startLabel)}
          </span>
          {duration && <span className="whitespace-nowrap text-gray-400 dark:text-gray-500"> · {duration}</span>}
        </span>
        {isFresh ? (
          <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">New</span>
        ) : journalHref ? (
          <a
            href={journalHref}
            className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
          >
            journal
          </a>
        ) : (
          <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${journalLinkClassName(segment.journalLink.status)}`}>
            {journalLinkLabel(segment.journalLink.status)}
          </span>
        )}
      </div>
      <p
        className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300 ${
          long && !expanded ? 'line-clamp-6' : ''
        }`}
      >
        {segment.transcript}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {segment.journalLink.skipReason && (
        <p className="mt-1 text-xs italic text-gray-400 dark:text-gray-500">{segment.journalLink.skipReason}</p>
      )}
      {segment.journalLink.status === 'skipped' && (
        <button
          type="button"
          onClick={() => onRequestJournalProposal(date, segment.id)}
          disabled={requesting}
          className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
        >
          {requesting ? 'Requesting…' : 'Request journal proposal'}
        </button>
      )}
    </article>
  );
}

function journalLinkLabel(status: OmiTranscriptJournalLinkStatus): string {
  if (status === 'logged') return 'logged';
  if (status === 'skipped') return 'skipped';
  if (status === 'requested') return 'requested';
  if (status === 'stale') return 'changed';
  return 'new';
}

function journalLinkClassName(status: OmiTranscriptJournalLinkStatus): string {
  if (status === 'logged') {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';
  }
  if (status === 'skipped') {
    return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
  }
  if (status === 'requested') {
    return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300';
  }
  if (status === 'stale') {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300';
  }
  return 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300';
}

function BatchStatusCard({ batch }: { batch: OmiTranscriptBatch }) {
  const failed = batch.status === 'failed';
  const active = batch.status === 'pending' || batch.status === 'running';
  const className = failed
    ? 'border-red-200 bg-red-50/80 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200'
    : active
      ? 'border-indigo-200 bg-white/70 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/30 dark:text-indigo-200'
      : 'border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200';

  return (
    <article className={`rounded-md border px-3 py-2 ${className}`}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold tabular-nums">
          {formatTimeRange(batch.startedAt, batch.endedAt, batch.startLabel, batch.endLabel)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-medium">
          {active && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />}
          {formatBatchStatus(batch.status)}
        </span>
      </div>
      {(batch.retryCount > 0 || batch.error) && (
        <div className="mt-1 text-xs opacity-80">
          {batch.retryCount > 0 && <span>{batch.retryCount} retries</span>}
          {batch.error && <p className="mt-1 break-words leading-relaxed">{batch.error}</p>}
        </div>
      )}
      {batch.retryAfter && failed && (
        <p className="mt-1 text-xs opacity-70">Retry after {formatClock(batch.retryAfter, '')}</p>
      )}
    </article>
  );
}

function WeekHeader({
  title,
  weekOffset,
  onPrevious,
  onNext,
  onToday,
}: {
  title: string;
  weekOffset: number;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="hidden sm:flex items-center justify-center gap-4 mb-4">
      <button
        onClick={onPrevious}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Previous week"
      >
        <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200">{title}</h2>

      <button
        onClick={onNext}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Next week"
      >
        <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {weekOffset !== 0 && (
        <button
          onClick={onToday}
          className="ml-2 px-3 py-1 text-sm rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
        >
          Today
        </button>
      )}
    </div>
  );
}
