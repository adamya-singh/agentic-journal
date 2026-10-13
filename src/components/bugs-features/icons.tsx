'use client';

import React from 'react';

/** A small sun on the horizon: the header button's mark. */
export function SunMark({ className }: { className?: string }) {
  const id = `bf-sun${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="50%" cy="80%" r="70%">
          <stop offset="0" stopColor="#fff6d8" />
          <stop offset=".5" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#ff9a3c" />
        </radialGradient>
      </defs>
      <path d="M5 17a7 7 0 0 1 14 0z" fill={`url(#${id})`} />
      <path d="M2.5 17.5h19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M12 5.2v1.8M5.6 8.3l1.2 1.2M18.4 8.3l-1.2 1.2"
        stroke="#ff9a3c"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A wider sunrise for empty states and the screenshot drop slot. */
export function Sunrise() {
  const id = `bf-sun${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 72 38" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="50%" cy="80%" r="70%">
          <stop offset="0" stopColor="#fff6d8" />
          <stop offset=".5" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#ff9a3c" />
        </radialGradient>
      </defs>
      <path d="M14 34a22 22 0 0 1 44 0z" fill={`url(#${id})`} opacity=".9" />
      <path d="M4 34.5h64" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M36 4v5M16 11l3 3M56 11l-3 3"
        stroke="#ff9a3c"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
