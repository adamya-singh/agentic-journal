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
  // The one link kept from an email: where Adamya starts the assessment. It is
  // shown on his OA task only, never sent to the AI report or opened by an agent.
  assessmentUrl: z
    .string()
    .trim()
    .max(2000)
    .url()
    // Many invitations use an http click-tracking redirect for the start button.
    .refine((s) => /^https?:\/\//.test(s), 'The assessment link must be http or https')
    .optional(),
});
export function eventDetails(value: unknown) {
  const result = EventDetailsSchema.safeParse(value);
  return result.success ? result.data : {};
}
