import { z } from 'zod';

export const JobTypeSchema = z.enum(['fall-coop', 'spring-coop', 'new-grad']);
export const JobListingStatusSchema = z.enum(['saved', 'starred', 'applied', 'archived']);
export const PostedDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'postedDate must use YYYY-MM-DD format');

const NotesWithProsAndConsSchema = z.string().min(1).refine(
  (value) => /pros:/i.test(value) && /cons:/i.test(value),
  { message: 'notes must include brief Pros: and Cons: sections from the perspective of life goals' }
);

export const JobListingFieldsSchema = z.object({
  company: z.string().min(1),
  companySummary: z.string().min(1),
  positionTitle: z.string().min(1),
  location: z.string().min(1),
  jobType: JobTypeSchema,
  status: JobListingStatusSchema.default('saved'),
  salary: z.string().min(1),
  link: z.string().url(),
  notes: NotesWithProsAndConsSchema,
  postedDate: PostedDateSchema.optional(),
});

export const UpdateJobListingFieldsSchema = JobListingFieldsSchema.partial().extend({
  notes: NotesWithProsAndConsSchema.optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' }
);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeJobListingFields(fields: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...fields };

  for (const key of ['company', 'companySummary', 'positionTitle', 'location', 'status', 'salary', 'link', 'notes', 'postedDate']) {
    const value = normalized[key];
    if (typeof value === 'string') {
      normalized[key] = value.trim();
    }
  }

  if (normalized.postedDate === '') {
    delete normalized.postedDate;
  }

  return normalized;
}
