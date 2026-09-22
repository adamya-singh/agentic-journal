'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function JobsNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Jobs views"
      className="flex gap-4 border-b border-gray-200 dark:border-gray-700 mb-6"
    >
      {[
        ['/jobs', 'Board'],
        ['/jobs/overview', 'Overview'],
      ].map(([url, label]) => (
        <Link
          key={url}
          href={url}
          aria-current={pathname === url ? 'page' : undefined}
          className={`px-2 py-3 text-sm ${pathname === url ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'text-gray-500'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
