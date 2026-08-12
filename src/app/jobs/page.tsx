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
  } = useJobBoardState();

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
