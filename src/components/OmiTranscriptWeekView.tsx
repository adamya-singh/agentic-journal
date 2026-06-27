'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
}

interface OmiTranscriptDay {
  date: string;
  segments: OmiTranscriptSegment[];
  omittedSegmentCount: number;
  status: {
    exists: boolean;
    segmentCount: number;
    transcriptCharCount: number;
    generatedAt?: string;
    newestTranscriptAt?: string;
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

export function OmiTranscriptWeekView() {
  const isMobile = useIsMobile();
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekDates, setWeekDates] = useState<DayInfo[]>(() => getWeekDates(0));
  const [transcripts, setTranscripts] = useState<Record<string, OmiTranscriptDay>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileDayOffsetFromToday, setMobileDayOffsetFromToday] = useState(0);

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
          const omittedSegmentCount = dayTranscript?.omittedSegmentCount ?? 0;

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
                  {hasFile
                    ? `${segments.length} segments · ${formatCharacterCount(dayTranscript.status.transcriptCharCount)}`
                    : 'No file'}
                </div>
              </div>

              <div className={isMobile ? 'flex-1 p-2 min-h-[260px]' : 'flex-1 p-2 min-h-[260px] max-h-[520px] overflow-y-auto'}>
                {segments.length > 0 ? (
                  <div className="space-y-3 animate-[weekviewFadeSlide_150ms_ease-out] motion-reduce:animate-none">
                    {segments.map((segment) => {
                      const duration = formatDuration(segment.durationSeconds);
                      return (
                        <article
                          key={segment.id}
                          className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30 px-3 py-2"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                            <span className={`font-medium ${isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'}`}>
                              {segment.startLabel}{segment.endLabel ? `-${segment.endLabel}` : ''}
                            </span>
                            {duration && (
                              <span className="shrink-0 text-gray-400 dark:text-gray-500">{duration}</span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                            {segment.transcript}
                          </p>
                        </article>
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
