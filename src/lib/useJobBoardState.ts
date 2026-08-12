'use client';

import React from 'react';
import type { JobApplicationResponseInput } from '@/components/JobApplicationModal';
import type {
  JobApplicationCategory,
  JobApplicationResumeVariant,
  JobApplicationsViewData,
  JobListing,
  JobListingsData,
} from '@/lib/types';

/**
 * Job board state and API handlers, shared by the main page (which keeps the
 * Cedar `jobListings` registration mounted for the agent's state-setter tools)
 * and the /jobs page (which renders the board).
 *
 * Deliberately Cedar-free: CedarCopilot wraps every route via the root layout,
 * so any useRegisterState here would also run on /jobs and fight the main
 * page's registration. Cedar wiring lives only in src/app/page.tsx.
 */
export function useJobBoardState() {
  const [jobListingsData, setJobListingsData] = React.useState<JobListingsData | null>(null);
  const [jobListingsLoading, setJobListingsLoading] = React.useState(true);
  const [jobListingsError, setJobListingsError] = React.useState<string | null>(null);
  const [jobApplicationsData, setJobApplicationsData] =
    React.useState<JobApplicationsViewData | null>(null);
  const [jobApplicationsLoading, setJobApplicationsLoading] = React.useState(true);
  const [jobApplicationsError, setJobApplicationsError] = React.useState<string | null>(null);

  const refreshJobListings = React.useCallback(async () => {
    setJobListingsLoading(true);
    setJobListingsError(null);

    try {
      const response = await fetch('/api/jobs/list');
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load job listings');
      }

      setJobListingsData({
        schemaVersion: 2,
        listings: Array.isArray(data.listings) ? data.listings : [],
      });
    } catch (error) {
      setJobListingsError(error instanceof Error ? error.message : 'Failed to load job listings');
    } finally {
      setJobListingsLoading(false);
    }
  }, []);

  const refreshJobApplications = React.useCallback(async () => {
    setJobApplicationsLoading(true);
    setJobApplicationsError(null);
    try {
      const response = await fetch('/api/jobs/applications/list', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load job applications');
      }
      setJobApplicationsData({
        schemaVersion: 1,
        workerEnabled: data.workerEnabled === true,
        enabledApplicationCategories: data.enabledApplicationCategories,
        readiness: data.readiness,
        counts: data.counts,
        categoryCounts: data.categoryCounts,
        eligibleBacklog: data.eligibleBacklog,
        applications: data.applications,
      });
    } catch (error) {
      setJobApplicationsError(
        error instanceof Error ? error.message : 'Failed to load job applications',
      );
    } finally {
      setJobApplicationsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshJobListings();
    refreshJobApplications();
  }, [refreshJobApplications, refreshJobListings]);

  const updateJobListingStatus = React.useCallback(
    async (id: string, status: JobListing['status']) => {
      const response = await fetch('/api/jobs/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update job listing status');
      }

      setJobListingsData({
        schemaVersion: 2,
        listings: data.listings,
      });
      await refreshJobApplications();
    },
    [refreshJobApplications],
  );

  const controlJobApplications = React.useCallback(
    async (action: 'start' | 'pause') => {
      const response = await fetch('/api/jobs/applications/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to ${action} job applications`);
      }
      await refreshJobApplications();
    },
    [refreshJobApplications],
  );

  const saveJobApplicationCategories = React.useCallback(
    async (enabledApplicationCategories: JobApplicationCategory[]) => {
      const response = await fetch('/api/jobs/applications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledApplicationCategories }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update application categories');
      }
      await refreshJobApplications();
    },
    [refreshJobApplications],
  );

  const saveJobApplicationAnswers = React.useCallback(
    async (
      listingId: string,
      resumeVariant: JobApplicationResumeVariant,
      responses: JobApplicationResponseInput[],
    ) => {
      const response = await fetch('/api/jobs/applications/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, resumeVariant, responses }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to save application answers');
      }
      await Promise.all([refreshJobApplications(), refreshJobListings()]);
    },
    [refreshJobApplications, refreshJobListings],
  );

  return {
    jobListingsData,
    setJobListingsData,
    jobListingsLoading,
    jobListingsError,
    jobApplicationsData,
    jobApplicationsLoading,
    jobApplicationsError,
    refreshJobListings,
    refreshJobApplications,
    updateJobListingStatus,
    controlJobApplications,
    saveJobApplicationCategories,
    saveJobApplicationAnswers,
  };
}
