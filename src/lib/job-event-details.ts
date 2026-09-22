import { z } from 'zod';
const safeText = z
  .string()
  .trim()
  .max(500)
  .refine(
    (s) => !/https?:\/\/|password|verification code|magic link/i.test(s),
    'Use a short paraphrase without URLs or credentials',
  );
export const EventDetailsSchema = z.object({
  eventKind: z.enum(['stage-change', 'assessment-reminder', 'still-reviewing']).optional(),
  assessmentType: safeText.optional(),
  provider: safeText.optional(),
  deadline: z.string().datetime({ offset: true }).optional(),
  interviewRound: safeText.optional(),
  outcomeReason: safeText.optional(),
  supportingParaphrase: safeText.optional(),
  automation: z.enum(['explicit', 'unknown']).optional(),
});
export function eventDetails(value: unknown) {
  const result = EventDetailsSchema.safeParse(value);
  return result.success ? result.data : {};
}
