import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  buildJobApplicationsView,
  JOB_APPLICATION_CATEGORIES,
  mutateJobApplicationsStore,
} from '../../application-store-utils';
import { wakeJobApplicationWorkerIfEnabled } from '../../application-worker-utils';
import { JobApplicationCategorySchema } from '../../route-utils';

export const runtime = 'nodejs';

const PreferencesSchema = z.object({
  enabledApplicationCategories: z
    .array(JobApplicationCategorySchema)
    .max(JOB_APPLICATION_CATEGORIES.length)
    .transform((categories) => [...new Set(categories)]),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = PreferencesSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.errors[0]?.message ?? 'Invalid application categories',
        },
        { status: 400 },
      );
    }

    const enabledApplicationCategories = JOB_APPLICATION_CATEGORIES.filter((category) =>
      parsed.data.enabledApplicationCategories.includes(category),
    );
    const enabledNewCategory = await mutateJobApplicationsStore((store) => {
      const enabled = enabledApplicationCategories.some(
        (category) => !store.enabledApplicationCategories.includes(category),
      );
      store.enabledApplicationCategories = enabledApplicationCategories;
      return enabled;
    });
    const worker = enabledNewCategory ? await wakeJobApplicationWorkerIfEnabled() : null;

    return NextResponse.json({
      success: true,
      ...buildJobApplicationsView(),
      ...(worker ? { worker } : {}),
    });
  } catch (error) {
    console.error('Error updating job application preferences:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update job application preferences' },
      { status: 500 },
    );
  }
}
