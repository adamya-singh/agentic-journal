'use client';

import React from 'react';
import { AppHeader } from '@/components/AppHeader';
import { JobListings } from '@/components/JobListings';
import { useJobBoardState } from '@/lib/useJobBoardState';

export default function JobsPage() {
  const {
    jobListingsData,
    jobListingsLoading,
    jobListingsError,
    jobApplicationsData,
    jobApplicationsLoading,
    jobApplicationsError,
    updateJobListingStatus,
    controlJobApplications,
    saveJobApplicationCategories,
    saveJobApplicationAnswers,
  } = useJobBoardState({ refetchOnFocus: true });

  // Prune local answer drafts for applications that are no longer awaiting input.
  React.useEffect(() => {
    if (!jobApplicationsData) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('job-app-draft:')) keys.push(key);
      }
      for (const key of keys) {
        const listingId = key.slice('job-app-draft:'.length);
        const application = jobApplicationsData.applications[listingId];
        if (!application || application.status !== 'awaiting-user-input') {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      // Best-effort cleanup.
    }
  }, [jobApplicationsData]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <AppHeader title="Jobs" subtitle="OpenClaw-maintained job board and application pipeline" />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <JobListings
          data={jobListingsData}
          loading={jobListingsLoading}
          error={jobListingsError}
          onStatusChange={updateJobListingStatus}
          applications={jobApplicationsData}
          applicationsLoading={jobApplicationsLoading}
          applicationsError={jobApplicationsError}
          onApplicationControl={controlJobApplications}
          onApplicationCategoriesChange={saveJobApplicationCategories}
          onApplicationSave={saveJobApplicationAnswers}
        />
      </div>
    </div>
  );
}
