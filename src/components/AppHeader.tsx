'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Menu, X } from 'lucide-react';
import { BugsFeaturesButton } from '@/components/bugs-features/BugsFeaturesButton';
import { OpenClawButton } from '@/components/OpenClawButton';

const NAV_LINKS = [
  { href: '/', label: 'Journal' },
  { href: '/library', label: 'Library' },
  { href: '/bookmarks', label: 'Bookmarks' },
  { href: '/media', label: 'Media' },
  { href: '/projects', label: 'Projects' },
  { href: '/compass', label: 'Compass' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/omi-transcripts', label: 'Transcripts' },
  { href: '/uptime', label: 'Status' },
] as const;

// Pages under a main link, and pages no main link covers. The phone menu lists them too, because the app
// added to the Home Screen has no URL bar or back button.
const SUB_LINKS: Partial<Record<string, readonly { href: string; label: string }[]>> = {
  '/media': [
    { href: '/media/feed', label: 'Feed' },
    { href: '/media/unwind', label: 'Unwind' },
    { href: '/media/tbpn', label: 'Diet TBPN' },
  ],
  '/jobs': [
    { href: '/jobs/overview', label: 'Overview' },
    { href: '/jobs/interviews', label: 'Interviews' },
  ],
};
const MORE_LINKS = [{ href: '/bugs-features', label: 'Bugs/Features' }] as const;

/** Tailwind's `sm`: at this width and up the header is the full desktop row. */
const WIDE_QUERY = '(min-width: 40rem)';

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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const headerRef = React.useRef<HTMLElement>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const sheetId = React.useId();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  const section = NAV_LINKS.find((link) => isActive(link.href));
  const subPage = section && SUB_LINKS[section.href]?.find((link) => isActive(link.href));
  const pageName = section?.label ?? MORE_LINKS.find((link) => isActive(link.href))?.label ?? title ?? 'Agentic Journal';

  // --app-header-h (globals.css) is a fixed 48px + safe-area inset on phones; above that, publish the real height.
  React.useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const wide = window.matchMedia(WIDE_QUERY);
    const sync = () => {
      if (wide.matches) {
        root.style.setProperty('--app-header-h', `${header.offsetHeight}px`);
        setMenuOpen(false);
      } else {
        root.style.removeProperty('--app-header-h');
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    wide.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      wide.removeEventListener('change', sync);
      root.style.removeProperty('--app-header-h');
    };
  }, []);

  React.useEffect(() => setMenuOpen(false), [pathname]);

  React.useEffect(() => {
    if (!menuOpen) return;
    // Lock scrolling on <html>: MobileClock (which can open from inside the menu) locks <body> on its own.
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const menuButton = menuButtonRef.current;
    root.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    // A dialog opened on top of the menu (the clock, the Bugs/Features drawer) handles its own keys.
    const anotherDialogIsOpen = () =>
      Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => el !== sheetRef.current);

    const handleKeyDown = (event: KeyboardEvent) => {
      const sheet = sheetRef.current;
      if (!sheet || anotherDialogIsOpen()) return;
      if (event.key === 'Escape') {
        setMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!sheet.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      menuButton?.focus({ preventScroll: true });
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header
      ref={headerRef}
      className="w-full border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 pt-[env(safe-area-inset-top)] sm:pt-0"
    >
      {/* Phone: one 48px bar (47px + the border), page name on the left, the menu holds the rest. */}
      <div className="flex h-[47px] items-center gap-3 pl-[max(16px,env(safe-area-inset-left))] pr-[max(6px,env(safe-area-inset-right))] sm:hidden">
        <p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-gray-900 dark:text-gray-100">
          {pageName}
          {subPage && <span className="font-normal text-gray-400 dark:text-gray-500"> / {subPage.label}</span>}
        </p>
        <div className="app-hit flex flex-none items-center gap-3">
          <OpenClawButton />
          <BugsFeaturesButton />
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls={sheetId}
          className="grid h-11 w-11 flex-none place-items-center rounded-full text-gray-700 transition-colors active:bg-gray-100 dark:text-gray-200 dark:active:bg-gray-800 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(255,154,60,.45)]"
        >
          <Menu className="h-[22px] w-[22px]" strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>

      <div className="hidden sm:flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 sm:px-4 py-2.5">
        <div className="min-w-0">
          {title ? (
            <>
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                {title}
              </h1>
              {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
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
          <OpenClawButton />
          <BugsFeaturesButton />
          {/* While the phone menu is open these live in it instead, so each renders once. */}
          {!menuOpen && actions}
          {!menuOpen && settings}
        </div>
      </div>

      {menuOpen && (
        <>
          <div
            aria-hidden="true"
            onClick={closeMenu}
            className="fixed inset-0 z-[10004] touch-none bg-gray-900/30 backdrop-blur-[3px] dark:bg-black/50 animate-in fade-in duration-200 motion-reduce:animate-none sm:hidden"
          />
          <div
            ref={sheetRef}
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-x-0 top-0 z-[10005] flex max-h-[100dvh] flex-col overflow-hidden rounded-b-[22px] bg-[#fbf8f4] text-[#1b2233] shadow-[0_30px_60px_-20px_rgba(27,34,51,.35)] dark:bg-[#0d1322] dark:text-[#eef2f8] dark:shadow-[0_30px_60px_-20px_rgba(0,0,0,.7)] animate-in slide-in-from-top duration-300 ease-out motion-reduce:animate-none sm:hidden"
          >
            {/* Dawn sky band, as on the Bugs/Features drawer */}
            <div className="relative flex-none overflow-hidden bg-[linear-gradient(180deg,#0b1730_0%,#1b3f6e_46%,#5b7aa6_74%,#c9a08a_91%,#e39a5f_100%)] pb-5 pl-[max(20px,env(safe-area-inset-left))] pr-[max(6px,env(safe-area-inset-right))] pt-[calc(1.5px+env(safe-area-inset-top))] text-[#fff6ec]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-[56px] right-[72px] h-[104px] w-[104px] rounded-full bg-[radial-gradient(circle_at_50%_45%,#fff6d8_0_30%,#ffd27a_52%,#ff9a3c_78%,#ff7a2f_100%)] shadow-[0_0_40px_14px_rgba(255,194,107,.55),0_0_120px_40px_rgba(255,154,60,.3)]"
              />
              <div className="relative flex items-start gap-3">
                <div className="min-w-0 flex-1 pt-3.5">
                  <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[rgba(230,236,244,.72)]">
                    Agentic Journal
                  </p>
                  <p className="mt-1 text-[32px] leading-none [font-family:var(--font-instrument-serif,Georgia),Georgia,serif]">
                    Where <em className="text-[#ffd27a]">to?</em>
                  </p>
                </div>
                {/* Sits where the menu button was, so the same tap opens and closes. */}
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeMenu}
                  aria-label="Close menu"
                  className="grid h-11 w-11 flex-none place-items-center rounded-full bg-white/10 text-white transition-colors active:bg-white/25 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(255,154,60,.6)]"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(12px,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
              {(actions || settings) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#ece5dc] px-5 py-3 dark:border-[#1f2a40]">
                  <span className="mr-auto font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#8a8f9a] dark:text-[#7684a0]">
                    This page
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {actions}
                    {settings}
                  </div>
                </div>
              )}

              <nav aria-label="Main navigation" className="px-3 pt-2">
                <ul>
                  {NAV_LINKS.map((link) => {
                    const active = isActive(link.href);
                    const subs = SUB_LINKS[link.href];
                    const activeSub = active ? subs?.find((sub) => isActive(sub.href)) : undefined;
                    return (
                      <li key={link.href}>
                        <MenuRow href={link.href} label={link.label} active={active} current={active && !activeSub} onNavigate={closeMenu} />
                        {subs && (
                          <div className="flex flex-wrap gap-2 pb-2 pl-[38px] pr-2">
                            {subs.map((sub) => {
                              const current = activeSub?.href === sub.href;
                              return (
                                <Link
                                  key={sub.href}
                                  href={sub.href}
                                  onClick={closeMenu}
                                  aria-current={current ? 'page' : undefined}
                                  className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
                                    current
                                      ? 'border-[#ff9a3c] bg-white text-[#1b2233] shadow-[0_0_0_3px_rgba(255,154,60,.22)] dark:bg-[#141c2f] dark:text-[#eef2f8]'
                                      : 'border-[#e2d8cc] text-[#4a5263] active:bg-[#ece5dc] dark:border-[#2a3752] dark:text-[#b7c1d3] dark:active:bg-[#1f2a40]'
                                  }`}
                                >
                                  {sub.label}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <ul className="mt-1 border-t border-[#ece5dc] pt-1 dark:border-[#1f2a40]">
                  {MORE_LINKS.map((link) => {
                    const active = isActive(link.href);
                    return (
                      <li key={link.href}>
                        <MenuRow href={link.href} label={link.label} active={active} current={active} onNavigate={closeMenu} />
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </div>
        </>
      )}
    </header>
  );
}

function MenuRow({
  href,
  label,
  active,
  current,
  onNavigate,
}: {
  href: string;
  label: string;
  /** The page is this link or under it. */
  active: boolean;
  /** The page is exactly this link (not one of its sub-pages). */
  current: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
      className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-[17px] font-medium transition-colors ${
        active
          ? 'bg-white text-[#1b2233] shadow-[0_1px_2px_rgba(27,34,51,.06),0_8px_20px_-12px_rgba(27,34,51,.25)] dark:bg-[#141c2f] dark:text-[#eef2f8] dark:shadow-none'
          : 'text-[#4a5263] active:bg-[#ece5dc] dark:text-[#b7c1d3] dark:active:bg-[#1f2a40]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 flex-none rounded-full ${active ? 'bg-[#ff9a3c] shadow-[0_0_8px_#ff9a3c]' : 'bg-[#e2d8cc] dark:bg-[#2a3752]'}`}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && (
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#8a8f9a] dark:text-[#7684a0]">
          You&rsquo;re here
        </span>
      )}
      <ChevronRight className="h-4 w-4 flex-none text-[#8a8f9a] dark:text-[#7684a0]" aria-hidden="true" />
    </Link>
  );
}
