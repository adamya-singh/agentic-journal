import { NextRequest, NextResponse } from 'next/server';
import {
  getConfiguredMaxBytes,
  getExpectedToken,
  parseSampleRate,
  saveOmiAudioChunk,
} from './audio-store-utils';

export const runtime = 'nodejs';
const DEFAULT_SAMPLE_RATE = 16000;

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const expectedToken = getExpectedToken();

    if (!expectedToken) {
      return NextResponse.json(
        { success: false, error: 'Omi audio ingest token is not configured' },
        { status: 500 }
      );
    }

    const contentType = request.headers.get('content-type') ?? '';
    const contentLength = request.headers.get('content-length');
    const sampleRateParam = searchParams.get('sample_rate');
    const uid = searchParams.get('uid');
    console.info('Omi audio ingest attempt', {
      contentType,
      contentLength,
      hasToken: Boolean(token),
      hasUid: Boolean(uid),
      sampleRate: sampleRateParam ?? null,
      userAgent: request.headers.get('user-agent') ?? '',
    });

    if (!isAuthorizedOmiToken(token, expectedToken)) {
      console.warn('Rejected Omi audio ingest request: unauthorized token', {
        contentType,
        contentLength,
        hasToken: Boolean(token),
      });
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!isSupportedAudioContentType(contentType)) {
      console.warn('Rejected Omi audio ingest request: unsupported content type', {
        contentType,
        contentLength,
      });
      return NextResponse.json(
        { success: false, error: 'Content-Type must be application/octet-stream or audio/*' },
        { status: 415 }
      );
    }

    const sampleRate = sampleRateParam ? parseSampleRate(sampleRateParam) : DEFAULT_SAMPLE_RATE;
    if (!sampleRate) {
      console.warn('Rejected Omi audio ingest request: unsupported sample rate', {
        sampleRate: sampleRateParam,
      });
      return NextResponse.json(
        { success: false, error: 'sample_rate must be 8000 or 16000' },
        { status: 400 }
      );
    }

    const maxBytes = getConfiguredMaxBytes();
    if (contentLength) {
      const parsedContentLength = Number(contentLength);
      if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBytes) {
        console.warn('Rejected Omi audio ingest request: content-length exceeds maximum', {
          contentLength,
          maxBytes,
        });
        return NextResponse.json(
          { success: false, error: `Audio chunk exceeds ${maxBytes} bytes` },
          { status: 413 }
        );
      }
    }

    const audioBytes = Buffer.from(await request.arrayBuffer());
    if (audioBytes.length === 0) {
      console.warn('Rejected Omi audio ingest request: empty body');
      return NextResponse.json(
        { success: false, error: 'Audio body must not be empty' },
        { status: 400 }
      );
    }

    if (audioBytes.length > maxBytes) {
      console.warn('Rejected Omi audio ingest request: body exceeds maximum', {
        bytes: audioBytes.length,
        maxBytes,
      });
      return NextResponse.json(
        { success: false, error: `Audio chunk exceeds ${maxBytes} bytes` },
        { status: 413 }
      );
    }

    if (audioBytes.length % 2 !== 0) {
      console.warn('Rejected Omi audio ingest request: odd PCM16 byte count', {
        bytes: audioBytes.length,
      });
      return NextResponse.json(
        { success: false, error: 'PCM16 audio body must contain an even number of bytes' },
        { status: 400 }
      );
    }

    const metadata = saveOmiAudioChunk({
      audioBytes,
      contentType,
      sampleRate,
      uid,
    });
    console.info('Accepted Omi audio chunk', {
      chunkId: metadata.chunkId,
      bytes: metadata.bytes,
      durationSeconds: metadata.durationSeconds,
      sampleRate: metadata.sampleRate,
      localDate: metadata.localDate,
    });

    return NextResponse.json({
      success: true,
      chunkId: metadata.chunkId,
      receivedAt: metadata.receivedAt,
      bytes: metadata.bytes,
      durationSeconds: metadata.durationSeconds,
      path: metadata.wavPath,
    });
  } catch (error) {
    console.error('Error ingesting Omi audio:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function isAuthorizedOmiToken(token: string | null, expectedToken: string): boolean {
  if (!token) {
    return false;
  }

  if (token === expectedToken) {
    return true;
  }

  // Some Omi UI/docs variants represent audio bytes settings as "url,seconds".
  // Accept that suffix if the app sends it through as part of the token value.
  if (token.startsWith(`${expectedToken},`) && /^,\d+$/.test(token.slice(expectedToken.length))) {
    return true;
  }

  // The Omi app appends sample_rate/uid with "?" even when the configured URL
  // already has a query string, so token can arrive as "<token>?sample_rate=...".
  return token.startsWith(`${expectedToken}?`);
}

function isSupportedAudioContentType(contentType: string): boolean {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();
  return normalized.startsWith('application/octet-stream') || normalized.startsWith('audio/');
}
