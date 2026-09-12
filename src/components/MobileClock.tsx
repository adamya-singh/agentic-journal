'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Clock3, X } from 'lucide-react';

const EASTERN_TIME_ZONE = 'America/New_York';

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN_TIME_ZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const zoneFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN_TIME_ZONE,
  timeZoneName: 'short',
});

function getClockParts(date: Date) {
  const parts = timeFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    hours: get('hour'),
    minutes: get('minute'),
    seconds: get('second'),
    dayPeriod: get('dayPeriod'),
    date: dateFormatter.format(date),
    zone:
      zoneFormatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'ET',
  };
}

export function MobileClock() {
  const [open, setOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const triggerButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;

    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 250);
    const previousOverflow = document.body.style.overflow;
    const triggerButton = triggerButtonRef.current;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);

    let wakeLock: { release: () => Promise<void> } | null = null;
    let clockClosed = false;
    const navigatorWithWakeLock = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    navigatorWithWakeLock.wakeLock
      ?.request('screen')
      .then((lock) => {
        if (clockClosed) {
          void lock.release();
          return;
        }
        wakeLock = lock;
      })
      .catch(() => {
        // The clock remains useful when the browser does not permit a wake lock.
      });

    return () => {
      clockClosed = true;
      window.clearInterval(interval);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      void wakeLock?.release();
      triggerButton?.focus();
    };
  }, [open]);

  const clock = getClockParts(now);

  return (
    <>
      <button
        ref={triggerButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="order-first flex shrink-0 items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 active:bg-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:hidden"
      >
        <Clock3 className="h-4 w-4" aria-hidden="true" />
        Clock
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Eastern Time clock"
            className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col overflow-hidden bg-[#08090b] text-white sm:hidden"
          >
            <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.8)]" />
                Eastern Time · {clock.zone}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close clock"
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/15 active:bg-white/20"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-1 -translate-y-[15dvh] flex-col items-center justify-center px-4 pb-[max(4rem,env(safe-area-inset-bottom))]">
              <div className="flex items-baseline justify-center font-mono font-medium leading-none tracking-[-0.075em] tabular-nums">
                <span className="text-[clamp(5.25rem,27vw,10rem)]">
                  {clock.hours}:{clock.minutes}
                </span>
                <span className="ml-[0.08em] text-[clamp(1.75rem,8vw,3rem)] text-indigo-300">
                  {clock.seconds}
                </span>
              </div>
              <div className="mt-5 flex items-center gap-3 text-base tracking-wide text-white/55">
                <span>{clock.dayPeriod}</span>
                <span className="h-1 w-1 rounded-full bg-white/25" />
                <span>{clock.date}</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
