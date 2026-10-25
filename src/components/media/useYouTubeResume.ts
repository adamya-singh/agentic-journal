'use client';

import { useEffect, useRef, useState } from 'react';
import { loadYouTube } from '@/components/media/feed/Player';

// The full YouTube player (www.youtube.com, not the nocookie host the feed uses),
// so plays count on the YouTube account this browser is signed in to. It reports
// where you are every few seconds, when you pause, and when you leave. Shared by
// Diet TBPN and Unwind.

interface YTPlayer {
  playVideo(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
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

export function useYouTubeResume({
  videoId,
  resumeAt,
  started,
  onPosition,
  onEnded,
  onFailed,
}: {
  videoId: string;
  resumeAt: number;
  // The player is created on the first press of Play; after that, a new id plays straight away.
  started: boolean;
  onPosition: (id: string, seconds: number, duration?: number) => void;
  onEnded: (id: string) => void;
  onFailed: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | undefined>(undefined);
  const current = useRef(videoId);
  const [playing, setPlaying] = useState(false);
  const cb = useRef({ onPosition, onEnded, onFailed });
  cb.current = { onPosition, onEnded, onFailed };

  const save = () => {
    const p = player.current;
    if (!p) return;
    const t = p.getCurrentTime();
    const d = p.getDuration?.();
    if (t > 0) cb.current.onPosition(current.current, t, d > 0 ? d : undefined);
  };

  useEffect(() => {
    if (!started || player.current) return;
    let cancelled = false;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    void loadYouTube().then((YT) => {
      if (cancelled) return;
      const Player = (YT as unknown as { Player: YTCtor }).Player;
      current.current = videoId;
      new Player(mount, {
        videoId,
        host: 'https://www.youtube.com',
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, start: Math.floor(resumeAt), playsinline: 1, rel: 0 },
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

  // Another video picked: save the old one's place, then load the new one.
  useEffect(() => {
    if (current.current === videoId) return;
    const p = player.current;
    if (p) {
      save();
      current.current = videoId;
      p.loadVideoById({ videoId, startSeconds: Math.floor(resumeAt) });
    } else current.current = videoId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

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

  return { host, playing };
}
