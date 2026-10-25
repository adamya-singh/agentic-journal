'use client';

import React from 'react';
import { Play } from 'lucide-react';
import { clock } from '@/components/media/feed/api';
import { useYouTubeResume } from '@/components/media/useYouTubeResume';

// Diet TBPN's player: the shared resumable YouTube player with TBPN's poster and Play button.

export interface PlayerEpisode {
  id: string;
  title: string;
  resumeAt: number;
  durationSec?: number;
}
export function TbpnPlayer({
  episode,
  poster,
  started,
  onStart,
  onPosition,
  onEnded,
  onFailed,
}: {
  episode: PlayerEpisode;
  poster: string;
  // Once you press play, picking another episode plays it straight away.
  started: boolean;
  onStart: () => void;
  onPosition: (id: string, seconds: number) => void;
  onEnded: (id: string) => void;
  onFailed: (id: string) => void;
}) {
  const { host, playing } = useYouTubeResume({
    videoId: episode.id,
    resumeAt: episode.resumeAt,
    started,
    onPosition: (id, t) => onPosition(id, t),
    onEnded,
    onFailed,
  });

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      {!playing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          referrerPolicy="no-referrer"
          className={`absolute inset-0 h-full w-full object-cover ${started ? 'opacity-0' : ''}`}
          onError={(e) => {
            const fallback = `https://i.ytimg.com/vi/${episode.id}/hqdefault.jpg`;
            if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
          }}
        />
      )}
      <div ref={host} className="absolute inset-0 [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full" />
      {!started && (
        <button
          type="button"
          onClick={onStart}
          aria-label={`Play ${episode.title}`}
          className="group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/50 via-transparent to-transparent focus-visible:outline-none"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-2xl transition group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-indigo-400">
            <Play size={32} fill="currentColor" className="ml-1" />
          </span>
          {episode.resumeAt > 0 && (
            <span className="absolute bottom-4 left-4 rounded-md bg-black/75 px-2 py-1 text-sm font-medium text-white">
              Resume at {clock(episode.resumeAt)}
            </span>
          )}
          {episode.resumeAt > 0 && episode.durationSec && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/35">
              <span
                className="block h-full bg-[#ff0033]"
                style={{ width: `${Math.min(100, (episode.resumeAt / episode.durationSec) * 100)}%` }}
              />
            </span>
          )}
        </button>
      )}
    </div>
  );
}
