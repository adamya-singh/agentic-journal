import Link from 'next/link';
import { OmiTranscriptWeekView } from '@/components/OmiTranscriptWeekView';

type OmiTranscriptsPageProps = {
  searchParams?: Promise<{
    date?: string | string[];
    segment?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OmiTranscriptsPage({
  searchParams,
}: OmiTranscriptsPageProps) {
  const resolvedSearchParams = await searchParams;
  const date = firstParam(resolvedSearchParams?.date);
  const segment = firstParam(resolvedSearchParams?.segment);
  const initialDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : undefined;
  const initialSegmentId = typeof segment === 'string' && segment.trim() ? segment : undefined;

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
        <OmiTranscriptWeekView initialDate={initialDate} initialSegmentId={initialSegmentId} />
      </div>
    </main>
  );
}
