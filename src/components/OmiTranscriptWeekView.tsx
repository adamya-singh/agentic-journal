'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
    recoverableBatchCount: number;
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

const DAY_NAMES_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) {
    return null;
  }

  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function formatCharacterCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k chars`;
  }

  return `${count} chars`;
}

function getBatchTimeKey(batch: OmiTranscriptBatch): string {
  return batch.startedAt ?? batch.id;
}

function getSegmentTimeKey(segment: OmiTranscriptSegment): string {
  return segment.startedAt ?? segment.id;
}

function formatBatchStatus(status: OmiTranscriptBatchStatus): string {
  if (status === 'failed') return 'Failed';
  if (status === 'pending') return 'Pending';
  if (status === 'running') return 'Running';
  if (status === 'completed') return 'Completed';
  return 'Missing';
}

function formatDaySummary(dayTranscript: OmiTranscriptDay | undefined, segmentCount: number): string {
  if (!dayTranscript?.status.exists) {
    return 'No file';
  }

  const status = dayTranscript.status;
  const parts = [`${segmentCount} segments`, formatCharacterCount(status.transcriptCharCount)];
  if (status.failedBatchCount > 0) {
    parts.push(`${status.failedBatchCount} failed`);
  }
  if (status.pendingBatchCount + status.runningBatchCount > 0) {
    parts.push(`${status.pendingBatchCount + status.runningBatchCount} active`);
  }
  if (status.missingChunkCount > 0) {
    parts.push(`${status.missingChunkCount} missing`);
  }
  if (status.audioChunkCount > 0) {
    parts.push(`${status.audioChunkCount} chunks`);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileDayOffsetFromToday, setMobileDayOffsetFromToday] = useState(initialDayOffset);
  const [retryingDates, setRetryingDates] = useState<Record<string, boolean>>({});
  const [requestingSegments, setRequestingSegments] = useState<Record<string, boolean>>({});
  const scrolledToInitialSegmentRef = useRef(false);

  useEffect(() => {
    setWeekDates(getWeekDates(weekOffset));
  }, [weekOffset]);

  useEffect(() => {
    if (!isMobile) return;
    const required = getWeekOffsetForDayOffset(mobileDayOffsetFromToday);
    setWeekOffset((prev) => (prev === required ? prev : required));
  }, [isMobile, mobileDayOffsetFromToday]);

  const fetchTranscripts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      for (const dayInfo of weekDates) {
        params.append('dates', dayInfo.date);
      }

      const response = await fetch(`/api/omi/transcripts?${params.toString()}`);
      const payload = (await response.json()) as OmiTranscriptResponse;

      if (!response.ok || !payload.success || !payload.transcripts) {
        setError(payload.error || 'Failed to fetch Omi transcripts');
        setTranscripts({});
        return;
      }

      setTranscripts(payload.transcripts);
    } catch {
      setError('Failed to connect to server');
      setTranscripts({});
    } finally {
      setLoading(false);
    }
  }, [weekDates]);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

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
      await fetchTranscripts();
    } catch {
      setError('Failed to connect to server');
    } finally {
      setRetryingDates((prev) => ({ ...prev, [date]: false }));
    }
  }, [fetchTranscripts]);

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
      await fetchTranscripts();
    } catch {
      setError('Failed to connect to server');
    } finally {
      setRequestingSegments((prev) => ({ ...prev, [key]: false }));
    }
  }, [fetchTranscripts]);

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

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <WeekHeader
          title={getWeekTitle()}
          weekOffset={weekOffset}
          onPrevious={() => setWeekOffset((prev) => prev - 1)}
          onNext={() => setWeekOffset((prev) => prev + 1)}
          onToday={() => setWeekOffset(0)}
        />
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

  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <WeekHeader
          title={getWeekTitle()}
          weekOffset={weekOffset}
          onPrevious={() => setWeekOffset((prev) => prev - 1)}
          onNext={() => setWeekOffset((prev) => prev + 1)}
          onToday={() => setWeekOffset(0)}
        />
        <div className="text-center text-red-500 dark:text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-2 sm:p-4">
      <WeekHeader
        title={getWeekTitle()}
        weekOffset={weekOffset}
        onPrevious={() => setWeekOffset((prev) => prev - 1)}
        onNext={() => setWeekOffset((prev) => prev + 1)}
        onToday={() => setWeekOffset(0)}
      />

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

      <div
        className={isMobile ? 'block' : 'grid gap-3'}
        style={isMobile ? undefined : { gridTemplateColumns }}
      >
        {visibleDayInfos.map((dayInfo) => {
          const dayTranscript = transcripts[dayInfo.date];
          const isToday = dayInfo.date === todayDate;
          const hasFile = dayTranscript?.status.exists === true;
          const segments = dayTranscript?.segments ?? [];
          const batches = dayTranscript?.batches ?? [];
          const incompleteBatches = batches.filter((batch) => batch.status !== 'completed');
          const failedBatchIds = batches
            .filter((batch) => batch.status === 'failed')
            .map((batch) => batch.id);
          const omittedSegmentCount = dayTranscript?.omittedSegmentCount ?? 0;
          const missingChunkCount = dayTranscript?.status.missingChunkCount ?? 0;
          const retrying = retryingDates[dayInfo.date] === true;
          const renderItems = [
            ...segments.map((segment) => ({ type: 'segment' as const, key: `segment:${segment.id}`, timeKey: getSegmentTimeKey(segment), segment })),
            ...incompleteBatches.map((batch) => ({ type: 'batch' as const, key: `batch:${batch.id}`, timeKey: getBatchTimeKey(batch), batch })),
          ].sort((a, b) => a.timeKey.localeCompare(b.timeKey));

          return (
            <div
              key={dayInfo.date}
              className={`flex flex-col rounded-lg border overflow-hidden ${
                isToday
                  ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-md'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
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
                  {formatDaySummary(dayTranscript, segments.length)}
                </div>
              </div>

              <div className={isMobile ? 'flex-1 p-2 min-h-[260px]' : 'flex-1 p-2 min-h-[260px] max-h-[520px] overflow-y-auto'}>
                {hasFile && (failedBatchIds.length > 0 || missingChunkCount > 0) && (
                  <div className="mb-3 space-y-2">
                    {failedBatchIds.length > 0 && (
                      <button
                        onClick={() => retryTranscriptBatches(dayInfo.date, failedBatchIds)}
                        disabled={retrying}
                        className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
                      >
                        {retrying ? 'Marking retry...' : `Retry ${failedBatchIds.length} failed`}
                      </button>
                    )}
                    {missingChunkCount > 0 && (
                      <button
                        onClick={() => retryTranscriptBatches(dayInfo.date)}
                        disabled={retrying}
                        className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
                      >
                        {retrying ? 'Marking retry...' : `Retry day · ${missingChunkCount} missing chunks`}
                      </button>
                    )}
                  </div>
                )}

                {renderItems.length > 0 ? (
                  <div className="space-y-3 animate-[weekviewFadeSlide_150ms_ease-out] motion-reduce:animate-none">
                    {renderItems.map((item) => {
                      if (item.type === 'batch') {
                        return <BatchStatusCard key={item.key} batch={item.batch} />;
                      }

                      const segment = item.segment;
                      const duration = formatDuration(segment.durationSeconds);
                      return (
                        <TranscriptSegmentCard
                          key={item.key}
                          segment={segment}
                          duration={duration}
                          isToday={isToday}
                          isHighlighted={segment.id === initialSegmentId}
                          date={dayInfo.date}
                          requesting={requestingSegments[`${dayInfo.date}:${segment.id}`] === true}
                          onRequestJournalProposal={requestJournalProposal}
                        />
                      );
                    })}
                    {omittedSegmentCount > 0 && (
                      <p className="text-center text-xs italic text-gray-400 dark:text-gray-500">
                        {omittedSegmentCount} background or empty segments omitted
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-center text-gray-400 dark:text-gray-500">
                    <p className="text-sm italic">{hasFile ? 'No speech transcript' : 'No transcript'}</p>
                    {omittedSegmentCount > 0 && (
                      <p className="text-xs italic">{omittedSegmentCount} background or empty segments omitted</p>
                    )}
                    {missingChunkCount > 0 && (
                      <p className="text-xs italic">{missingChunkCount} audio chunks are not covered by any batch</p>
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

function TranscriptSegmentCard({
  segment,
  duration,
  isToday,
  isHighlighted,
  date,
  requesting,
  onRequestJournalProposal,
}: {
  segment: OmiTranscriptSegment;
  duration: string | null;
  isToday: boolean;
  isHighlighted: boolean;
  date: string;
  requesting: boolean;
  onRequestJournalProposal: (date: string, segmentId: string) => void;
}) {
  const journalRef = segment.journalLink.journalRefs[0];
  const journalHref = journalRef
    ? `/?date=${encodeURIComponent(journalRef.date)}&journalEntry=${encodeURIComponent(journalRef.journalEntryId)}`
    : null;

  return (
    <article
      id={`omi-segment-${segment.id}`}
      className={`rounded-md border bg-gray-50/70 px-3 py-2 transition-colors dark:bg-gray-900/30 ${
        isHighlighted
          ? 'border-amber-300 ring-2 ring-amber-300/70 dark:border-amber-500 dark:ring-amber-500/60'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className={`font-medium ${isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {segment.startLabel}{segment.endLabel ? `-${segment.endLabel}` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {journalHref ? (
            <a
              href={journalHref}
              className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              journal
            </a>
          ) : (
            <span className={`rounded border px-1.5 py-0.5 font-medium ${journalLinkClassName(segment.journalLink.status)}`}>
              {journalLinkLabel(segment.journalLink.status)}
            </span>
          )}
          {duration && <span className="text-gray-400 dark:text-gray-500">{duration}</span>}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {segment.transcript}
      </p>
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
          {requesting ? 'Requesting...' : 'Request journal proposal'}
        </button>
      )}
    </article>
  );
}

function journalLinkLabel(status: OmiTranscriptJournalLinkStatus): string {
  if (status === 'logged') return 'logged';
  if (status === 'skipped') return 'skipped';
  if (status === 'requested') return 'requested';
  if (status === 'stale') return 'stale';
  return 'new';
}

function journalLinkClassName(status: OmiTranscriptJournalLinkStatus): string {
  if (status === 'logged') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (status === 'skipped') {
    return 'border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
  }
  if (status === 'requested') {
    return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300';
  }
  if (status === 'stale') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300';
  }
  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300';
}

function BatchStatusCard({ batch }: { batch: OmiTranscriptBatch }) {
  const duration = formatDuration(batch.durationSeconds);
  const failed = batch.status === 'failed';
  const active = batch.status === 'pending' || batch.status === 'running';
  const className = failed
    ? 'border-red-200 bg-red-50/80 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200'
    : active
      ? 'border-sky-200 bg-sky-50/80 text-sky-800 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-200'
      : 'border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200';

  return (
    <article className={`rounded-md border px-3 py-2 ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold">
          {batch.startLabel}{batch.endLabel ? `-${batch.endLabel}` : ''}
        </span>
        <span className="shrink-0 font-medium">{formatBatchStatus(batch.status)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs opacity-80">
        {duration && <span>{duration}</span>}
        {batch.chunkCount > 0 && <span>{batch.chunkCount} chunks</span>}
        {batch.retryCount > 0 && <span>{batch.retryCount} retries</span>}
      </div>
      {batch.error && (
        <p className="mt-2 break-words text-xs leading-relaxed opacity-90">{batch.error}</p>
      )}
      {batch.retryAfter && failed && (
        <p className="mt-1 text-xs opacity-70">Retry after {new Date(batch.retryAfter).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
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
