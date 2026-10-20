'use client';

import React from 'react';
import { ArrowUpRight, Shrimp } from 'lucide-react';
import { controlUiBase } from '@/lib/openclaw-ui';

/** The header button on every page: opens the OpenClaw Control UI in a new tab. */
export function OpenClawButton() {
  // The URL depends on the host the page was loaded from, so it's only known in the browser.
  const [href, setHref] = React.useState<string>();
  React.useEffect(() => setHref(controlUiBase()), []);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the OpenClaw Control UI in a new tab"
      aria-label="Open OpenClaw (new tab)"
      className="flex-none inline-flex items-center gap-1.5 h-8 px-2 sm:pl-2.5 sm:pr-2 rounded-full border border-gray-200 dark:border-gray-700 text-[13px] font-medium text-gray-700 dark:text-gray-300 transition-[border-color,box-shadow] hover:border-[#ff7a59] dark:hover:border-[#ff7a59] hover:shadow-[0_0_0_4px_rgba(255,122,89,.22)] focus-visible:outline-none focus-visible:border-[#ff7a59] dark:focus-visible:border-[#ff7a59] focus-visible:shadow-[0_0_0_4px_rgba(255,122,89,.22)]"
    >
      <Shrimp className="w-[18px] h-[18px] text-[#ff7a59]" strokeWidth={1.8} aria-hidden="true" />
      <span className="hidden sm:inline">OpenClaw</span>
      <ArrowUpRight className="hidden sm:block w-3.5 h-3.5 text-gray-400 dark:text-gray-500" aria-hidden="true" />
    </a>
  );
}
