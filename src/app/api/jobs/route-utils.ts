import { z } from 'zod';

export const JobApplicationCategorySchema = z.enum([
  'fall-internship',
  'spring-internship',
  'summer-internship',
  'new-grad',
]);
export const JobApplicationCategoriesSchema = z
  .array(JobApplicationCategorySchema)
  .min(1, 'applicationCategories must contain at least one category')
  .transform((categories) => [...new Set(categories)]);
export const JobListingStatusSchema = z.enum(['saved', 'starred', 'applied', 'archived']);
export const PostedDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'postedDate must use YYYY-MM-DD format');
export const PostedDateTextSchema = z.string().min(1);
export const JobListingSourceSchema = z.object({
  name: z.string().min(1),
  link: z.string().url(),
});

export const JobTrackSchema = z.enum(['focus', 'wide']);

/** North Star postings are judged for fit, so their notes carry Pros and Cons. Wide-net ones are not judged. */
export const NOTES_NEED_PROS_AND_CONS =
  'notes must include brief Pros: and Cons: sections from the perspective of life goals';
export function notesHaveProsAndCons(notes: string): boolean {
  return /pros:/i.test(notes) && /cons:/i.test(notes);
}

const JobListingFieldsObject = z.object({
  company: z.string().min(1),
  companySummary: z.string().min(1),
  positionTitle: z.string().min(1),
  location: z.string().min(1),
  applicationCategories: JobApplicationCategoriesSchema,
  track: JobTrackSchema.default('focus'),
  status: JobListingStatusSchema.default('saved'),
  salary: z.string().min(1),
  link: z.string().url(),
  source: JobListingSourceSchema,
  notes: z.string().min(1),
  postedDate: PostedDateSchema.optional(),
  postedDateText: PostedDateTextSchema.optional(),
});

export const JobListingFieldsSchema = JobListingFieldsObject.refine(
  (data) => data.track === 'wide' || notesHaveProsAndCons(data.notes),
  { message: NOTES_NEED_PROS_AND_CONS, path: ['notes'] },
);

// Whether new notes need Pros and Cons depends on the stored posting's track; the update route checks.
export const UpdateJobListingFieldsSchema = JobListingFieldsObject.partial()
  .extend({ track: JobTrackSchema.optional() })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeJobListingFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...fields };

  if (normalized.applicationCategories === undefined && typeof normalized.jobType === 'string') {
    const legacyCategories: Record<string, string> = {
      'fall-coop': 'fall-internship',
      'spring-coop': 'spring-internship',
      'new-grad': 'new-grad',
    };
    const category = legacyCategories[normalized.jobType.trim()];
    if (category) {
      normalized.applicationCategories = [category];
    }
  }
  delete normalized.jobType;

  for (const key of [
    'company',
    'companySummary',
    'positionTitle',
    'location',
    'status',
    'track',
    'salary',
    'link',
    'notes',
    'postedDate',
    'postedDateText',
  ]) {
    const value = normalized[key];
    if (typeof value === 'string') {
      normalized[key] = value.trim();
    }
  }

  if (isRecord(normalized.source)) {
    normalized.source = {
      ...normalized.source,
      name:
        typeof normalized.source.name === 'string'
          ? normalized.source.name.trim()
          : normalized.source.name,
      link:
        typeof normalized.source.link === 'string'
          ? normalized.source.link.trim()
          : normalized.source.link,
    };
  }

  if (normalized.postedDate === '') {
    delete normalized.postedDate;
  }

  if (normalized.postedDateText === '') {
    delete normalized.postedDateText;
  }

  return normalized;
}
