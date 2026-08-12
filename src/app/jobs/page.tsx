'use client';

import React from 'react';
import Link from 'next/link';
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
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Jobs
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              OpenClaw-maintained job board and application pipeline
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 underline-offset-4 hover:underline"
          >
            Back to Journal
          </Link>
        </div>

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
