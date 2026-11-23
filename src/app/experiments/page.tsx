'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { AppHeader } from '@/components/AppHeader';

// The sky is Sunrise's engine, which is only ever built in the browser.
const ExperimentsView = dynamic(() => import('@/components/experiments/ExperimentsView').then((m) => m.ExperimentsView), { ssr: false });

export default function ExperimentsPage() {
  return (
    <>
      <AppHeader title="Experiments" subtitle="What is in play, and the record under it" />
      <main>
        <ExperimentsView />
      </main>
    </>
  );
}
