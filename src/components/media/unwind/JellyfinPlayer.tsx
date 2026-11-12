'use client';
import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { feedApi } from '../feed/api';
import type { Playback } from '@/lib/media/jellyfin-playback';

interface Props {
  id: string;
  episodeKey: string;
  resumeAt: number;
  poster?: string;
  onPosition: (seconds: number, duration?: number) => void;
  onEnded: () => void;
  onFailed: () => void;
}
export function JellyfinPlayer(props: Props) {
  const video = useRef<HTMLVideoElement>(null),
    callbacks = useRef(props);
  callbacks.current = props;
  const resume = useRef(props.resumeAt);
  const [audio, setAudio] = useState<number>(),
    [bitrate, setBitrate] = useState(12_000_000);
  const [playback, setPlayback] = useState<Playback>(),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false,
      session: Playback | undefined,
      hls: Hls | undefined;
    const v = video.current!;
    const duration = () =>
      session?.durationSec || (Number.isFinite(v.duration) ? v.duration : undefined);
    const position = () => v.currentTime;
    const save = () => {
      if (!session) return;
      resume.current = position();
      callbacks.current.onPosition(position(), duration());
      void feedApi('playback/progress', {
        token: session.token,
        position: position(),
        paused: v.paused,
      }).catch(() => {});
    };
    const stop = (p = session) => {
      if (p)
        void fetch('/api/media/playback/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: p.token }),
          keepalive: true,
        });
    };
    const ended = () => {
      save();
      callbacks.current.onEnded();
      stop();
    };
    const failed = () => setError('Playback failed. Check Jellyfin, then retry.');
    const loaded = () => {
      if (resume.current > 0) v.currentTime = resume.current;
      void v.play().catch(() => {});
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') save();
    };
    const pagehide = () => {
      save();
      stop();
    };
    v.addEventListener('loadedmetadata', loaded);
    v.addEventListener('pause', save);
    v.addEventListener('ended', ended);
    v.addEventListener('error', failed);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    setError('');
    void feedApi<Playback>('playback/start', {
      id: props.id,
      key: props.episodeKey,
      audioIndex: audio,
      bitrate,
      h264: !!v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
    })
      .then((p) => {
        if (disposed) {
          stop(p);
          return;
        }
        session = p;
        setPlayback(p);
        if (p.hls && !v.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 30 });
          hls.loadSource(p.src);
          hls.attachMedia(v);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) failed();
          });
        } else v.src = p.src;
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    const timer = setInterval(save, 10_000);
    return () => {
      disposed = true;
      clearInterval(timer);
      save();
      stop();
      hls?.destroy();
      v.removeEventListener('loadedmetadata', loaded);
      v.removeEventListener('pause', save);
      v.removeEventListener('ended', ended);
      v.removeEventListener('error', failed);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      v.removeAttribute('src');
      v.load();
    };
  }, [props.id, props.episodeKey, audio, bitrate, attempt]);
  // Stop the previous session before switching stream parameters, rather than opening a second transcode.
  const change = async (fn: () => void) => {
    if (playback) {
      video.current?.pause();
      await feedApi('playback/stop', { token: playback.token });
    }
    fn();
  };
  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={video}
        controls
        autoPlay
        playsInline
        poster={props.poster}
        className="h-full w-full"
        crossOrigin="anonymous"
      >
        {playback?.subtitles.map((s) => (
          <track
            key={s.src}
            kind="subtitles"
            src={s.src}
            srcLang={s.lang.slice(0, 2)}
            label={s.label}
            default={/^en(g)?$/.test(s.lang)}
          />
        ))}
      </video>
      <div className="absolute right-2 top-2 flex gap-2 rounded bg-black/70 p-1 text-xs text-white">
        {!!playback?.audio.length && (
          <select
            aria-label="Audio language"
            value={audio ?? ''}
            onChange={(e) =>
              void change(() =>
                setAudio(e.target.value ? Number(e.target.value) : undefined),
              ).catch((e) => setError(e.message))
            }
            className="max-w-40 bg-black"
          >
            <option value="">Original / default audio</option>
            {playback.audio.map((a) => (
              <option key={a.index} value={a.index}>
                {a.label}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Streaming quality"
          value={bitrate}
          onChange={(e) =>
            void change(() => setBitrate(Number(e.target.value))).catch((e) => setError(e.message))
          }
          className="bg-black"
        >
          <option value={12_000_000}>1080p · 12 Mbps</option>
          <option value={6_000_000}>1080p · 6 Mbps</option>
          <option value={3_000_000}>720p · 3 Mbps</option>
        </select>
      </div>
      {error && (
        <div
          role="alert"
          className="absolute inset-x-4 bottom-16 rounded bg-black/90 p-3 text-sm text-white"
        >
          {error}{' '}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() =>
              void change(() => setAttempt((n) => n + 1)).catch((e) => setError(e.message))
            }
          >
            Retry playback
          </button>
          <button type="button" className="ml-3 underline" onClick={props.onFailed}>
            Try another source
          </button>
        </div>
      )}
    </div>
  );
}
