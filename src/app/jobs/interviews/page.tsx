'use client';

import { Instrument_Serif } from 'next/font/google';
import { AppHeader } from '@/components/AppHeader';
import { JobsNavigation } from '@/components/JobsNavigation';
import { Casebook } from '@/components/interviews/Casebook';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });

export default function InterviewsPage() {
  return (
    <div className={`min-h-screen bg-white dark:bg-gray-900 ${serif.variable}`}>
      <AppHeader title="Jobs" subtitle="OpenClaw-maintained job board and application pipeline" />
      <div className="mx-auto max-w-[1480px] px-3 py-4 sm:px-4 sm:py-6">
        <JobsNavigation />
        <Casebook />
      </div>
    </div>
  );
}
