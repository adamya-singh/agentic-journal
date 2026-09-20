'use client';

/* eslint-disable @next/next/no-img-element -- screenshots use private dynamic URLs and must retain original resolution. */

import React from 'react';
import { ExternalLink, X } from 'lucide-react';

/** Full-screen viewer for a single screenshot; Escape or a backdrop click closes it. */
export function ScreenshotLightbox({
  src,
  alt,
  caption,
  onClose,
}: {
  src: string;
  alt: string;
  caption?: string;
  onClose: () => void;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    // Capture phase, so Escape closes only this viewer and not a dialog beneath it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex flex-col bg-slate-950/90 p-3 sm:p-6"
    >
      <div className="flex shrink-0 items-center gap-3 pb-3 text-sm text-slate-100" onClick={(event) => event.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate font-medium">{caption ?? alt}</p>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded px-2 text-xs font-medium text-slate-200 hover:bg-white/10"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Full resolution
        </a>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close screenshot"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
        <img
          src={src}
          alt={alt}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full rounded bg-white object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}
