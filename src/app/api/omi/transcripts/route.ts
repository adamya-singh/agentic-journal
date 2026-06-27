import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TRANSCRIPT_DIR = path.join(process.cwd(), 'src/backend/data/omi-transcripts');
const DEFAULT_TIMEZONE = 'America/New_York';
const NON_CONTENT_TRANSCRIPTS = new Set([
  '[background]',
  '[background].',
  '[no speech]',
  '[no speech].',
  '[inaudible]',
  '[inaudible].',
  '[silence]',
  '[silence].',
  '_no transcript text returned._',
]);

type OmiTranscriptSegment = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  startLabel: string;
  endLabel: string;
  durationSeconds: number | null;
  transcript: string;
};

type OmiTranscriptDay = {
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
};

type RawTranscriptFile = {
  date?: string;
  generatedAt?: string;
  segments?: unknown[];
};

type RawTranscriptSegment = {
  id?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  durationSeconds?: unknown;
  transcript?: unknown;
  completedAt?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dates = getRequestedDates(searchParams);

    if (!dates.every(isValidDate)) {
      return NextResponse.json(
        { success: false, error: 'dates must use YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    const transcripts = Object.fromEntries(dates.map((date) => [date, readTranscriptDay(date)]));

    return NextResponse.json({
      success: true,
      dates,
      transcripts,
    });
  } catch (error) {
    console.error('Error reading Omi transcripts:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getRequestedDates(searchParams: URLSearchParams): string[] {
  const explicitDates = searchParams
    .getAll('dates')
    .concat(searchParams.getAll('dates[]'))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  if (explicitDates.length > 0) {
    return Array.from(new Set(explicitDates));
  }

  const weekOffset = Number(searchParams.get('weekOffset') ?? '0');
  return getWeekDates(Number.isInteger(weekOffset) ? weekOffset : 0);
}

function readTranscriptDay(date: string): OmiTranscriptDay {
  const rawPath = path.join(TRANSCRIPT_DIR, `${date}.raw.json`);
  const markdownPath = path.join(TRANSCRIPT_DIR, `${date}.md`);

  if (fs.existsSync(rawPath)) {
    return readRawTranscriptDay(date, rawPath);
  }

  if (fs.existsSync(markdownPath)) {
    return readMarkdownTranscriptDay(date, markdownPath);
  }

  return emptyTranscriptDay(date, false);
}

function readRawTranscriptDay(date: string, rawPath: string): OmiTranscriptDay {
  try {
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8')) as RawTranscriptFile;
    const rawSegments = Array.isArray(raw.segments) ? raw.segments : [];
    const allSegments = rawSegments.map(normalizeRawSegment).sort(compareSegments);
    const segments = allSegments.filter((segment) => isUsableTranscript(segment.transcript));
    const newestTranscriptAt = rawSegments
      .map((segment) => {
        const completedAt = (segment as RawTranscriptSegment)?.completedAt;
        return typeof completedAt === 'string' ? completedAt : null;
      })
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return {
      date,
      segments,
      omittedSegmentCount: allSegments.length - segments.length,
      status: {
        exists: true,
        segmentCount: segments.length,
        transcriptCharCount: segments.reduce((total, segment) => total + segment.transcript.length, 0),
        ...(typeof raw.generatedAt === 'string' ? { generatedAt: raw.generatedAt } : {}),
        ...(newestTranscriptAt ? { newestTranscriptAt } : {}),
      },
    };
  } catch {
    return emptyTranscriptDay(date, true);
  }
}

function readMarkdownTranscriptDay(date: string, markdownPath: string): OmiTranscriptDay {
  try {
    const markdown = fs.readFileSync(markdownPath, 'utf-8');
    const generatedAt = markdown.match(/^Generated:\s*(.+)$/m)?.[1]?.trim();
    const sections = markdown.split(/^##\s+/m).slice(1);
    const allSegments = sections.map(normalizeMarkdownSection).sort(compareSegments);
    const segments = allSegments.filter((segment) => isUsableTranscript(segment.transcript));

    return {
      date,
      segments,
      omittedSegmentCount: allSegments.length - segments.length,
      status: {
        exists: true,
        segmentCount: segments.length,
        transcriptCharCount: segments.reduce((total, segment) => total + segment.transcript.length, 0),
        ...(generatedAt ? { generatedAt } : {}),
      },
    };
  } catch {
    return emptyTranscriptDay(date, true);
  }
}

function normalizeRawSegment(segment: unknown): OmiTranscriptSegment {
  const raw = (segment && typeof segment === 'object' ? segment : {}) as RawTranscriptSegment;
  const id = typeof raw.id === 'string' ? raw.id : 'unknown';
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null;
  const endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : null;
  const durationSeconds = typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds)
    ? raw.durationSeconds
    : null;
  const transcript = typeof raw.transcript === 'string' ? raw.transcript.trim() : '';
  const labels = labelsForSegment(id, startedAt, endedAt);

  return {
    id,
    startedAt,
    endedAt,
    startLabel: labels.startLabel,
    endLabel: labels.endLabel,
    durationSeconds,
    transcript,
  };
}

function normalizeMarkdownSection(section: string, index: number): OmiTranscriptSegment {
  const lines = section.split('\n');
  const heading = lines.shift()?.trim() || `segment-${index + 1}`;
  const sourceLineIndex = lines.findIndex((line) => line.startsWith('Source:'));
  const transcriptLines = lines
    .slice(sourceLineIndex >= 0 ? sourceLineIndex + 1 : 0)
    .map((line) => line.trim())
    .filter(Boolean);
  const transcript = transcriptLines.join(' ').trim();
  const labels = labelsForSegment(heading, null, null);

  return {
    id: heading,
    startedAt: null,
    endedAt: null,
    startLabel: labels.startLabel,
    endLabel: labels.endLabel,
    durationSeconds: parseMarkdownDuration(lines[sourceLineIndex] ?? ''),
    transcript,
  };
}

function labelsForSegment(id: string, startedAt: string | null, endedAt: string | null): {
  startLabel: string;
  endLabel: string;
} {
  const startFromDate = startedAt ? formatTimeLabel(startedAt) : null;
  const endFromDate = endedAt ? formatTimeLabel(endedAt) : null;

  if (startFromDate && endFromDate) {
    return { startLabel: startFromDate, endLabel: endFromDate };
  }

  const [rawStart, rawEnd] = id.split(/\s*--\s*|\s+-\s+/);
  return {
    startLabel: formatSegmentIdTime(rawStart) || 'Unknown',
    endLabel: formatSegmentIdTime(rawEnd) || '',
  };
}

function compareSegments(a: OmiTranscriptSegment, b: OmiTranscriptSegment): number {
  if (a.startedAt && b.startedAt) {
    return a.startedAt.localeCompare(b.startedAt);
  }
  return a.id.localeCompare(b.id);
}

function isUsableTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return normalized.length > 0 && !NON_CONTENT_TRANSCRIPTS.has(normalized);
}

function emptyTranscriptDay(date: string, exists: boolean): OmiTranscriptDay {
  return {
    date,
    segments: [],
    omittedSegmentCount: 0,
    status: {
      exists,
      segmentCount: 0,
      transcriptCharCount: 0,
    },
  };
}

function getWeekDates(offset: number): string[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday + offset * 7);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return toISODate(date);
  });
}

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDate(value: string): boolean {
  return DATE_REGEX.test(value);
}

function formatTimeLabel(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString('en-US', {
    timeZone: getConfiguredTimezone(),
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function getConfiguredTimezone(): string {
  const timezone = process.env.OMI_AUDIO_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function formatSegmentIdTime(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parts = value.trim().match(/^(\d{1,2})-(\d{2})(?:-\d{2})?$/);
  if (!parts) {
    return value.trim() || null;
  }

  return `${parts[1].padStart(2, '0')}:${parts[2]}`;
}

function parseMarkdownDuration(sourceLine: string): number | null {
  const minutesMatch = sourceLine.match(/(\d+(?:\.\d+)?)m/);
  const secondsMatch = sourceLine.match(/(\d+(?:\.\d+)?)s/);
  const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
  const seconds = secondsMatch ? Number(secondsMatch[1]) : 0;
  const total = minutes * 60 + seconds;
  return total > 0 ? total : null;
}
