import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateSourceSchema, normalizeEmploymentDate, validateEmploymentDate } from '../src/lib/employment-dates';
import { extractSimplifyExperiences, resolveDate, formatDate, verifyReadback } from './simplify-employment-dates.mjs';
import type { JobApplicationQuestion } from '../src/lib/types';

const source = { experienceId: 'moodys', field: 'end' as const, value: '2026-08', attemptCount: 3 };
const question: JobApplicationQuestion = {
  id: 'date', prompt: "Moody's Analytics (Software Engineering Intern) - End Date",
  kind: 'text', required: true, resolution: 'pending', discoveredAt: '2026-09-18T00:00:00Z', dateSource: source,
};
test('employment date regression and format equivalence', () => {
  for (const answer of ['08/2026', '2026-08']) assert.doesNotThrow(() => validateEmploymentDate(question, answer, 3));
  for (const answer of ['08/2025', '2026', 'August', '2026-08-01', ['08/2026']]) {
    assert.throws(() => validateEmploymentDate(question, answer, 3));
  }
  assert.throws(() => validateEmploymentDate(question, '08/2026', 4));
  assert.throws(() => validateEmploymentDate({ ...question, dateSource: undefined }, '08/2026', 3));
  assert.throws(() => validateEmploymentDate({ ...question, employmentDateField: 'start' }, '08/2026', 3));
  assert.equal(normalizeEmploymentDate('13/2026'), undefined);
  assert.equal(DateSourceSchema.safeParse({ ...source, field: 'start', value: 'present' }).success, false);
  assert.doesNotThrow(() => validateEmploymentDate({ ...question, dateSource: undefined, prompt: 'Project End Date' }, '2024', 3));
});
test('fixed extraction, unique matching, current employment, and readback', () => {
  const records = extractSimplifyExperiences({ secret: 'omit', experience: [{ id: 'moodys', company: { name: "Moody's Analytics" }, title: 'Intern', start_month: 6, start_year: 2026, end_month: 8, end_year: 2026, currently_working: false, description: 'omit' }] });
  assert.equal(JSON.stringify(records).includes('omit'), false);
  const request = { employer: "Moody’s Analytics", title: 'Intern', field: 'end', attemptCount: 3 };
  assert.deepEqual(resolveDate(records, request), source);
  assert.throws(() => resolveDate([...records, ...records], request));
  assert.throws(() => resolveDate([], request));
  assert.throws(() => resolveDate([{ ...records[0], endYear: null }], request));
  assert.equal(resolveDate([{ ...records[0], currentlyWorking: true }], request).value, 'present');
  assert.equal(formatDate(source, 'MM/YYYY'), '08/2026');
  assert.throws(() => formatDate(source, 'MM/DD/YYYY'));
  assert.equal(verifyReadback(source, '08/2026'), true);
  assert.throws(() => verifyReadback(source, '08/2025'));
});
