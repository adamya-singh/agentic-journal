import { z } from 'zod';
import { resolveAssessmentDeadline } from './assessment-deadline';
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
  deadlineWindow: z.object({
    count: z.number().int().min(1).max(365),
    unit: z.enum(['business-days', 'calendar-days', 'hours']),
    timeZone: z.string().refine(zone => {
      try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
    }, 'Invalid deadline timezone').optional(),
  }).optional(),
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
export function eventDetails(value: unknown, receivedAt?: string) {
  const result = EventDetailsSchema.safeParse(value);
  if (!result.success) return {};
  const details = result.data;
  const origin = receivedAt ?? (value && typeof value === 'object' && 'receivedAt' in value ? String(value.receivedAt) : undefined);
  if (!details.deadline && details.deadlineWindow && origin) {
    details.deadline = resolveAssessmentDeadline(origin, details.deadlineWindow);
  }
  return details;
}
