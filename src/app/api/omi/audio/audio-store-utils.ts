import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_SAMPLE_RATES = new Set([8000, 16000]);
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type OmiAudioChunkMetadata = {
  chunkId: string;
  receivedAt: string;
  localDate: string;
  uid: string;
  sampleRate: number;
  bytes: number;
  durationSeconds: number;
  contentType: string;
  source: 'omi-audio-bytes';
  wavPath: string;
  metadataPath: string;
};

export type OmiAudioStatus = {
  date: string;
  chunks: number;
  totalBytes: number;
  approximateCapturedSeconds: number;
  newestChunkReceivedAt: string | null;
  lastChunks: OmiAudioChunkMetadata[];
};

export function getConfiguredMaxBytes(): number {
  const rawValue = process.env.OMI_AUDIO_MAX_BYTES;
  if (!rawValue) {
    return DEFAULT_MAX_BYTES;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

export function getConfiguredTimezone(): string {
  const timezone = process.env.OMI_AUDIO_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function getExpectedToken(): string | null {
  const token = process.env.OMI_AUDIO_INGEST_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function isAuthorizedToken(token: string | null): boolean {
  const expectedToken = getExpectedToken();
  return Boolean(expectedToken && token && token === expectedToken);
}

export function parseSampleRate(rawValue: string | null): number | null {
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || !ALLOWED_SAMPLE_RATES.has(parsed)) {
    return null;
  }

  return parsed;
}

export function isValidDate(value: string): boolean {
  return DATE_REGEX.test(value);
}

export function getOmiAudioDataDir(): string {
  return path.join(process.cwd(), 'src/backend/data/omi-audio');
}

export function getLocalDateString(date = new Date(), timezone = getConfiguredTimezone()): string {
  return getLocalDateParts(date, timezone).date;
}

export function saveOmiAudioChunk(params: {
  audioBytes: Buffer;
  contentType: string;
  sampleRate: number;
  uid: string | null;
  receivedAt?: Date;
}): OmiAudioChunkMetadata {
  const receivedAt = params.receivedAt ?? new Date();
  const timezone = getConfiguredTimezone();
  const localParts = getLocalDateParts(receivedAt, timezone);
  const chunkId = randomUUID();
  const baseName = `${localParts.time}-${chunkId}`;
  const relativeDayDir = path.join('src/backend/data/omi-audio', localParts.date);
  const absoluteDayDir = path.join(process.cwd(), relativeDayDir);
  const wavPath = path.join(absoluteDayDir, `${baseName}.wav`);
  const metadataPath = path.join(absoluteDayDir, `${baseName}.json`);
  const relativeWavPath = path.join(relativeDayDir, `${baseName}.wav`);
  const relativeMetadataPath = path.join(relativeDayDir, `${baseName}.json`);
  const durationSeconds = params.audioBytes.length / (params.sampleRate * 2);

  fs.mkdirSync(absoluteDayDir, { recursive: true });

  const wavBytes = createPcm16MonoWav(params.audioBytes, params.sampleRate);
  writeFileAtomically(wavPath, wavBytes);

  const metadata: OmiAudioChunkMetadata = {
    chunkId,
    receivedAt: receivedAt.toISOString(),
    localDate: localParts.date,
    uid: params.uid ?? '',
    sampleRate: params.sampleRate,
    bytes: params.audioBytes.length,
    durationSeconds,
    contentType: params.contentType,
    source: 'omi-audio-bytes',
    wavPath: relativeWavPath,
    metadataPath: relativeMetadataPath,
  };

  writeFileAtomically(metadataPath, Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'));
  fs.appendFileSync(
    path.join(absoluteDayDir, 'manifest.jsonl'),
    `${JSON.stringify(metadata)}\n`,
    'utf-8'
  );

  return metadata;
}

export function readOmiAudioStatus(date: string): OmiAudioStatus {
  const manifestPath = path.join(getOmiAudioDataDir(), date, 'manifest.jsonl');
  if (!fs.existsSync(manifestPath)) {
    return {
      date,
      chunks: 0,
      totalBytes: 0,
      approximateCapturedSeconds: 0,
      newestChunkReceivedAt: null,
      lastChunks: [],
    };
  }

  const entries = fs
    .readFileSync(manifestPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as OmiAudioChunkMetadata];
      } catch {
        return [];
      }
    });

  const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  const approximateCapturedSeconds = entries.reduce(
    (total, entry) => total + entry.durationSeconds,
    0
  );
  const newestChunkReceivedAt = entries.at(-1)?.receivedAt ?? null;

  return {
    date,
    chunks: entries.length,
    totalBytes,
    approximateCapturedSeconds,
    newestChunkReceivedAt,
    lastChunks: entries.slice(-20),
  };
}

function createPcm16MonoWav(audioBytes: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = audioBytes.length;
  const fileSize = 36 + dataSize;
  const byteRate = sampleRate * 2;
  const blockAlign = 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, audioBytes]);
}

function writeFileAtomically(filePath: string, data: Buffer): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, data);
  fs.renameSync(tempPath, filePath);
}

function getLocalDateParts(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const valueFor = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Unable to format ${type} in timezone ${timezone}`);
    }
    return value;
  };

  const year = valueFor('year');
  const month = valueFor('month');
  const day = valueFor('day');
  const hour = valueFor('hour');
  const minute = valueFor('minute');
  const second = valueFor('second');
  const millisecond = String(date.getMilliseconds()).padStart(3, '0');

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}-${minute}-${second}-${millisecond}`,
  };
}
