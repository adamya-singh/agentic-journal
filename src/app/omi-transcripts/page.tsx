import { AppHeader } from '@/components/AppHeader';
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
      <AppHeader title="Transcripts" />

      <div className="pt-2 pb-4">
        <OmiTranscriptWeekView initialDate={initialDate} initialSegmentId={initialSegmentId} />
      </div>
    </main>
  );
}
