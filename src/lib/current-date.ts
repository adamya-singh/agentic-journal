'use client';

import { useEffect, useState } from 'react';

export function getCurrentDateISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Fires onRollover just after each local midnight so a tab left open
// overnight stops reading and writing yesterday's date.
export function scheduleMidnightRollover(onRollover: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    timer = setTimeout(() => {
      onRollover();
      schedule();
    }, nextMidnight.getTime() - now.getTime());
  };
  schedule();
  return () => clearTimeout(timer);
}

export function useCurrentDateISO(): string {
  const [date, setDate] = useState(getCurrentDateISO());
  useEffect(() => scheduleMidnightRollover(() => setDate(getCurrentDateISO())), []);
  return date;
}
