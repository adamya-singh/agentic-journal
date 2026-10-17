'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ExternalLink, Play, Volume2, VolumeX } from 'lucide-react';

// One sound switch for the whole feed: videos start muted (browsers only allow
// that), and after you turn sound on once, every next video plays with sound.
interface Sound {
  on: boolean;
  set: (on: boolean) => void;
}
export const SoundContext = createContext<Sound>({ on: false, set: () => {} });
export const useSound = () => useContext(SoundContext);

// The playing video, so keyboard shortcuts (space) reach it.
export interface PlayerControls {
  toggle: () => void;
}
let activeControls: PlayerControls | undefined;
export const togglePlayback = () => activeControls?.toggle();

// ---- YouTube IFrame API (loaded once, on first use) ----
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  getPlayerState(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
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
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let ytReady: Promise<YTNamespace> | undefined;
export function loadYouTube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytReady ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return ytReady;
}
const PLAYING = 1,
  ENDED = 0,
  PAUSED = 2;

export function SoundPill({ muted, onToggle, className = '' }: { muted: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={muted ? 'Turn sound on' : 'Mute'}
      title={muted ? 'Turn sound on (M)' : 'Mute (M)'}
      className={`absolute bottom-14 left-3 z-10 inline-flex items-center gap-2 rounded-full bg-black/65 px-3.5 py-2 text-sm font-medium text-white shadow-lg ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${muted ? 'animate-[feedPulse_2.4s_ease-in-out_infinite]' : '!px-2.5'} ${className}`}
    >
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      {muted && <span>Tap for sound</span>}
    </button>
  );
}

export function YouTubePlayer({
  videoId,
  thumbnail,
  active,
  title,
  url,
  short,
  onEnded,
  onActivate,
}: {
  videoId: string;
  thumbnail: string;
  active: boolean;
  title: string;
  url: string;
  short?: boolean;
  onEnded?: () => void;
  onActivate?: () => void;
}) {
  const sound = useSound();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  useEffect(() => {
    if (!active || failed) return;
    let cancelled = false;
    let p: YTPlayer | undefined;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    void loadYouTube().then((YT) => {
      if (cancelled) return;
      p = new YT.Player(mount, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            player.current = e.target;
            setReady(true);
            e.target.mute();
            e.target.playVideo();
            if (soundRef.current.on) {
              e.target.unMute();
              e.target.setVolume(85);
              setMuted(false);
              // If the browser refused sound, it pauses: fall back to muted play.
              setTimeout(() => {
                if (cancelled || !player.current) return;
                if (player.current.getPlayerState() !== PLAYING && player.current.getPlayerState() !== 3) {
                  player.current.mute();
                  player.current.playVideo();
                  setMuted(true);
                  soundRef.current.set(false);
                }
              }, 1200);
            }
          },
          onStateChange: (e) => {
            if (e.data === PLAYING) setPlaying(true);
            if (e.data === ENDED) endedRef.current?.();
          },
          onError: () => setFailed(true),
        },
      });
    });
    activeControls = {
      toggle: () => {
        const q = player.current;
        if (!q) return;
        if (q.getPlayerState() === PLAYING) q.pauseVideo();
        else q.playVideo();
      },
    };
    return () => {
      cancelled = true;
      try {
        p?.destroy();
      } catch {
        /* Already gone. */
      }
      player.current = undefined;
      mount.remove();
      setPlaying(false);
      setReady(false);
      setMuted(true);
    };
  }, [active, videoId, failed]);

  // The shared switch flipped (another video, or the M key).
  useEffect(() => {
    const q = player.current;
    if (!q) return;
    if (sound.on && q.isMuted()) {
      q.unMute();
      q.setVolume(85);
      setMuted(false);
    } else if (!sound.on && !q.isMuted()) {
      q.mute();
      setMuted(true);
    }
  }, [sound.on]);

  const toggleSound = () => {
    const q = player.current;
    if (!q) return;
    if (muted) {
      q.unMute();
      q.setVolume(85);
      if (q.getPlayerState() === PAUSED) q.playVideo();
      setMuted(false);
      sound.set(true);
    } else {
      q.mute();
      setMuted(true);
      sound.set(false);
    }
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnail}
        alt=""
        referrerPolicy="no-referrer"
        className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${short ? 'object-contain' : 'object-cover'} ${active && playing ? 'opacity-0' : 'opacity-100'}`}
      />
      <div ref={host} className="absolute inset-0 [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full" />
      {!active && !failed && (
        <button
          type="button"
          onClick={onActivate}
          aria-label={`Play ${title}`}
          className="group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/40 via-transparent to-transparent"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-2xl transition group-hover:scale-105 dark:bg-white/85">
            <Play size={26} fill="currentColor" className="ml-1" />
          </span>
        </button>
      )}
      {failed && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm font-medium text-white"
        >
          <ExternalLink size={20} /> This one only plays on YouTube
        </a>
      )}
      {active && ready && !failed && <SoundPill muted={muted} onToggle={toggleSound} />}
    </div>
  );
}

// Saved X videos and GIFs: a plain <video>, same muted-first rule.
export function ClipPlayer({
  src,
  poster,
  active,
  gif,
  label,
  onEnded,
  onActivate,
  aspect,
}: {
  src: string;
  poster?: string;
  active: boolean;
  gif?: boolean;
  label: string;
  onEnded?: () => void;
  onActivate?: () => void;
  aspect?: number;
}) {
  const sound = useSound();
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!active) {
      v.pause();
      return;
    }
    const wantSound = sound.on && !gif;
    v.muted = !wantSound;
    setMuted(!wantSound);
    v.play()
      .then(() => setStarted(true))
      .catch(() => {
        v.muted = true;
        setMuted(true);
        if (wantSound) sound.set(false);
        void v.play().then(() => setStarted(true)).catch(() => {});
      });
    activeControls = { toggle: () => (v.paused ? void v.play() : v.pause()) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    const v = ref.current;
    if (!v || !active || gif) return;
    v.muted = !sound.on;
    setMuted(!sound.on);
  }, [sound.on, active, gif]);
  return (
    <div
      className="relative w-full overflow-hidden bg-black"
      style={{ aspectRatio: aspect ? String(Math.max(0.56, Math.min(aspect, 2.4))) : '16 / 9', maxHeight: '78vh' }}
    >
      <video
        ref={ref}
        src={src}
        poster={poster}
        playsInline
        loop={gif}
        muted
        controls={started && !gif}
        preload={active ? 'auto' : 'metadata'}
        aria-label={label}
        onEnded={onEnded}
        className="h-full w-full object-contain"
      />
      {!active && (
        <button
          type="button"
          onClick={onActivate}
          aria-label={`Play ${label}`}
          className="group absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-2xl transition group-hover:scale-105">
            <Play size={22} fill="currentColor" className="ml-0.5" />
          </span>
        </button>
      )}
      {active && !gif && (
        <SoundPill
          muted={muted}
          onToggle={() => {
            const v = ref.current;
            if (!v) return;
            v.muted = !muted;
            setMuted(!muted);
            sound.set(muted);
            if (v.paused) void v.play();
          }}
        />
      )}
    </div>
  );
}
