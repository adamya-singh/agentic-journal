'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { loadYouTube } from '@/components/media/feed/Player';
import { clock } from '@/components/media/feed/api';

// The full YouTube player (www.youtube.com, not the nocookie host the feed uses),
// so plays count on the YouTube account this browser is signed in to. It reports
// where you are every few seconds and when you pause or leave.

interface YTPlayer {
  playVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
}
type YTCtor = new (
  el: HTMLElement,
  opts: {
    videoId: string;
    host?: string;
    width?: string;
    height?: string;
    playerVars?: Record<string, number | string>;
    events?: {
      onReady?: (e: { target: YTPlayer }) => void;
      onStateChange?: (e: { data: number; target: YTPlayer }) => void;
      onError?: (e: { data: number }) => void;
    };
  },
) => YTPlayer;
const ENDED = 0,
  PLAYING = 1,
  PAUSED = 2;
const SAVE_EVERY_MS = 10_000;

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
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | undefined>(undefined);
  const current = useRef(episode.id);
  const [playing, setPlaying] = useState(false);
  const cb = useRef({ onPosition, onEnded, onFailed });
  cb.current = { onPosition, onEnded, onFailed };

  const save = () => {
    const p = player.current;
    if (!p) return;
    const t = p.getCurrentTime();
    if (t > 0) cb.current.onPosition(current.current, t);
  };

  // Create the player on the first press of Play.
  useEffect(() => {
    if (!started || player.current) return;
    let cancelled = false;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    void loadYouTube().then((YT) => {
      if (cancelled) return;
      const Player = (YT as unknown as { Player: YTCtor }).Player;
      current.current = episode.id;
      new Player(mount, {
        videoId: episode.id,
        host: 'https://www.youtube.com',
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, start: Math.floor(episode.resumeAt), playsinline: 1, rel: 0 },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            player.current = e.target;
            e.target.playVideo();
          },
          onStateChange: (e) => {
            setPlaying(e.data === PLAYING);
            if (e.data === PAUSED) save();
            if (e.data === ENDED) cb.current.onEnded(current.current);
          },
          onError: () => cb.current.onFailed(current.current),
        },
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Another episode picked: save the old one's place, then load the new one.
  useEffect(() => {
    if (current.current === episode.id) return;
    const p = player.current;
    if (p) {
      save();
      current.current = episode.id;
      p.loadVideoById({ videoId: episode.id, startSeconds: Math.floor(episode.resumeAt) });
    } else current.current = episode.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id]);

  // Save while playing, when the tab is hidden, and on the way out.
  useEffect(() => {
    const tick = setInterval(() => {
      if (player.current?.getPlayerState() === PLAYING) save();
    }, SAVE_EVERY_MS);
    const hidden = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', save);
      save();
      try {
        player.current?.destroy();
      } catch {
        /* Already gone. */
      }
      player.current = undefined;
    };
  }, []);

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
