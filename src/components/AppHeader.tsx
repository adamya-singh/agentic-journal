'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/', label: 'Journal' },
  { href: '/library', label: 'Library' },
  { href: '/projects', label: 'Projects' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/omi-transcripts', label: 'Transcripts' },
] as const;

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  /** Page-specific controls (e.g. the Projects context-date input). */
  actions?: React.ReactNode;
  /** The settings gear; only the main page passes this (chat-mode state lives there). */
  settings?: React.ReactNode;
}

export function AppHeader({ title, subtitle, actions, settings }: AppHeaderProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="w-full border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 sm:px-4 py-2.5">
        <div className="min-w-0">
          {title ? (
            <>
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
              )}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto whitespace-nowrap">
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? 'page' : undefined}
                className={
                  isActive(link.href)
                    ? 'px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 text-white shadow-sm'
                    : 'px-2.5 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors'
                }
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {actions}
          {settings}
        </div>
      </div>
    </header>
  );
}
