import Link from 'next/link';
import { OmiTranscriptWeekView } from '@/components/OmiTranscriptWeekView';

export default function OmiTranscriptsPage() {
  return (
    <main className="relative min-h-screen w-full bg-white pb-12 dark:bg-gray-900">
      <div className="hidden sm:block absolute top-4 right-4 z-10">
        <Link
          href="/"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Journal
        </Link>
      </div>

      <div className="sm:hidden flex items-center justify-end gap-2 px-3 pt-3">
        <Link
          href="/"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Journal
        </Link>
      </div>

      <div className="pt-2 sm:pt-16 pb-4">
        <OmiTranscriptWeekView />
      </div>
    </main>
  );
}
