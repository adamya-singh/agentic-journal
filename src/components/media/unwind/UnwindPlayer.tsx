'use client';

import React, { useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { clock } from '@/components/media/feed/api';
import { useYouTubeResume } from '@/components/media/useYouTubeResume';
import type { PlayableSource } from '@/lib/media/unwind-view';

// Plays one episode or film in the Journal: a file from your library in a plain
// <video>, or a studio's own YouTube upload in the full YouTube player. Both
// report where you are so the next visit resumes there.

interface Props {
  source: PlayableSource;
  title: string;
  poster?: string;
  resumeAt: number;
  started: boolean;
  onStart: () => void;
  onPosition: (seconds: number, duration?: number) => void;
  onEnded: () => void;
  onFailed: () => void;
}

const SAVE_EVERY_MS = 10_000;

function FilePlayer({ source, poster, resumeAt, onPosition, onEnded, onFailed }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef({ onPosition, onEnded, onFailed });
  cb.current = { onPosition, onEnded, onFailed };
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const save = () => v.currentTime > 0 && cb.current.onPosition(v.currentTime, Number.isFinite(v.duration) ? v.duration : undefined);
    const seek = () => {
      if (resumeAt > 0 && v.currentTime < 1) v.currentTime = resumeAt;
    };
    const tick = setInterval(() => !v.paused && save(), SAVE_EVERY_MS);
    const hidden = () => document.visibilityState === 'hidden' && save();
    const ended = () => cb.current.onEnded();
    const failed = () => cb.current.onFailed();
    v.addEventListener('loadedmetadata', seek);
    v.addEventListener('pause', save);
    v.addEventListener('ended', ended);
    v.addEventListener('error', failed);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(tick);
      save();
      v.removeEventListener('loadedmetadata', seek);
      v.removeEventListener('pause', save);
      v.removeEventListener('ended', ended);
      v.removeEventListener('error', failed);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', save);
    };
    // A new source remounts this component (keyed by the page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <video
      ref={video}
      src={source.src}
      poster={poster}
      controls
      autoPlay
      playsInline
      preload="metadata"
      className="absolute inset-0 h-full w-full bg-black"
    >
      {source.subtitles?.map((t, i) => (
        <track key={t.src} kind="subtitles" src={t.src} srcLang={t.lang.slice(0, 2)} label={t.lang} default={i === 0 && /^en/.test(t.lang)} />
      ))}
    </video>
  );
}

function TubePlayer({ source, started, resumeAt, onPosition, onEnded, onFailed }: Props) {
  const { host } = useYouTubeResume({
    videoId: source.videoId!,
    resumeAt,
    started,
    onPosition: (_id, t, d) => onPosition(t, d ?? source.durationSec),
    onEnded: () => onEnded(),
    onFailed: () => onFailed(),
  });
  return <div ref={host} className="absolute inset-0 [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full" />;
}

export function UnwindPlayer(props: Props) {
  const { source, title, poster, resumeAt, started, onStart } = props;
  const still = poster || (source.videoId ? `https://i.ytimg.com/vi/${source.videoId}/maxresdefault.jpg` : undefined);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-[0_30px_60px_-30px_rgba(18,10,38,.8)]">
      {started ? (
        source.kind === 'file' ? <FilePlayer {...props} /> : <TubePlayer {...props} />
      ) : (
        <button
          type="button"
          onClick={onStart}
          aria-label={`Play ${title}`}
          className="group absolute inset-0 flex items-center justify-center focus-visible:outline-none"
        >
          {still && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={still} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover opacity-80" />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-[#120a26]/80 via-transparent to-transparent" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/90 text-[#3b1f5e] shadow-2xl transition group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-violet-400">
            <Play size={32} fill="currentColor" className="ml-1" />
          </span>
          {resumeAt > 0 && (
            <span className="absolute bottom-4 left-4 rounded-md bg-black/75 px-2 py-1 text-sm font-medium text-white">Resume at {clock(resumeAt)}</span>
          )}
          <span className="absolute bottom-4 right-4 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white/85">
            {source.kind === 'file' ? 'From your library' : `YouTube · ${source.channel || 'official upload'}`}
          </span>
        </button>
      )}
    </div>
  );
}
