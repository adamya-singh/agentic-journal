import { z } from 'zod';
import type { JobApplicationQuestion } from './types';

export class EmploymentDateError extends Error {}

export const DateSourceSchema = z.object({
  experienceId: z.string().trim().min(1),
  field: z.enum(['start', 'end']),
  value: z.string().regex(/^(?:[1-9]\d{3}-(?:0[1-9]|1[0-2])|present)$/),
  attemptCount: z.number().int().positive(),
}).refine((source) => source.value !== 'present' || source.field === 'end', {
  message: 'Only an employment end date can be present',
});

export function normalizeEmploymentDate(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  if (text === 'present') return text;
  if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(text)) return text;
  const match = /^(0[1-9]|1[0-2])\/([1-9]\d{3})$/.exec(text);
  return match ? `${match[2]}-${match[1]}` : undefined;
}

export function employmentDateField(question: JobApplicationQuestion): 'start' | 'end' | undefined {
  if (question.employmentDateField) return question.employmentDateField;
  // Legacy employer-specific prompts, e.g. "Moody's (Software Intern) - End Date".
  const legacy = /.+\([^()]+\)\s*[-–—:]\s*(start|end)\s+date\s*$/i.exec(question.prompt);
  const contextual = /employment|work experience|internship/i.test(question.section ?? '')
    ? /\b(start|end)\s+date\b/i.exec(question.prompt) : null;
  return (legacy?.[1] ?? contextual?.[1])?.toLowerCase() as 'start' | 'end' | undefined;
}

export function validateEmploymentDate(
  question: JobApplicationQuestion, answer: string | string[], attemptCount: number,
): void {
  const field = employmentDateField(question) ?? question.dateSource?.field;
  if (!field) return;
  const source = DateSourceSchema.safeParse(question.dateSource);
  if (!source.success || source.data.field !== field || source.data.attemptCount !== attemptCount) {
    throw new EmploymentDateError(`Fresh Simplify date source required: ${question.prompt}`);
  }
  if (typeof answer !== 'string' || normalizeEmploymentDate(answer) !== source.data.value) {
    throw new EmploymentDateError(`Employment date conflicts with Simplify: ${question.prompt}`);
  }
}
