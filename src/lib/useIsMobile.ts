'use client';

import { useEffect, useState } from 'react';

const MOBILE_MAX_WIDTH_PX = 640;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/**
 * Returns true when the viewport width is at or below the Tailwind `sm` breakpoint (640px).
 * SSR-safe: returns false on the server and during the first client render, then updates
 * after mount. Use for behavioral switches (e.g. render a card list vs a table). For
 * pure styling, prefer Tailwind's responsive variants.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }

    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  return isMobile;
}
