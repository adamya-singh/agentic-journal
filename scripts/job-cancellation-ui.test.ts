import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { isApplicationSubmissionInFlight } from '../src/lib/job-application-cancellation';
import type { JobApplicationRecord, JobApplicationsViewData } from '../src/lib/types';

// Render the real component without changing the repository's Node TS loader.
const require = createRequire(import.meta.url);
const exports: Record<string, React.ComponentType<{ applications: JobApplicationsViewData; onCancel: (listingId: string, reason: string) => Promise<void>; onResolve?: (reviewId: string, action: 'confirm' | 'correct' | 'leave-blank') => Promise<void> }>> = {};
const code = ts.transpileModule(readFileSync(new URL('../src/components/ApplicationReviewPanel.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
new Function('require', 'exports', code)((name: string) => {
  if (name === '@/lib/job-application-cancellation') return { isApplicationSubmissionInFlight };
  if (name === './ScreenshotLightbox') return { ScreenshotLightbox: () => null };
  return require(name);
}, exports);

function cancellationButton(overrides: Partial<JobApplicationRecord>): string | undefined {
  const application = { listingId: 'motorola', status: 'awaiting-user-input', questions: [], ...overrides };
  const data = {
    applications: { motorola: application },
    reviewItems: [{ id: 'review', listingId: 'motorola', questionId: 'question', question: 'Authorized to work in Canada?',
      answerUsed: 'No', clarificationPrompt: 'Confirm this answer', confidence: 1, company: 'Motorola Solutions',
      role: 'Junior Software Engineer', status: 'pending' }],
  } as unknown as JobApplicationsViewData;
  const markup = renderToStaticMarkup(React.createElement(exports.ApplicationReviewPanel, {
    applications: data, onCancel: async () => {},
  }));
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes('Cancel application'));
}

test('Motorola-style stalled drafts show an enabled cancellation button despite a historical attempt', () => {
  const button = cancellationButton({ submissionAttemptedAt: '2026-09-19T01:40:50.549Z' });
  assert.ok(button);
  assert.equal(button.includes('disabled='), false);
});

test('a new worker lease does not make an old submission attempt block cancellation', () => {
  const now = Date.now();
  const button = cancellationButton({ submissionAttemptedAt: new Date(now - 86400000).toISOString(),
    lease: { token: 'new-run', claimedAt: new Date(now - 300000).toISOString(), expiresAt: new Date(now + 300000).toISOString() } });
  assert.ok(button);
  assert.equal(button.includes('disabled='), false);
});

test('a submission in the live lease keeps cancellation visible but disabled with an explanation', () => {
  const now = Date.now();
  const button = cancellationButton({ submissionAttemptedAt: new Date(now - 60000).toISOString(),
    lease: { token: 'submitting', claimedAt: new Date(now - 300000).toISOString(), expiresAt: new Date(now + 300000).toISOString() } });
  assert.ok(button);
  assert.ok(button.includes('disabled='));
  assert.ok(button.includes('Wait for its result before cancelling'));
});

test('expired submission leases do not block cancellation; submitted applications have no control', () => {
  const now = Date.now();
  const button = cancellationButton({ submissionAttemptedAt: new Date(now - 600000).toISOString(),
    lease: { token: 'expired', claimedAt: new Date(now - 900000).toISOString(), expiresAt: new Date(now - 300000).toISOString() } });
  assert.ok(button);
  assert.equal(button.includes('disabled='), false);
  assert.equal(cancellationButton({ status: 'submitted', submittedAt: new Date(now).toISOString() }), undefined);
});

function blankButton(required: boolean, overrides: Partial<JobApplicationRecord> = {}): string | undefined {
  const question = { id: 'pronunciation', prompt: 'Name Pronunciation', kind: 'text', required,
    answer: 'Ah-dum-yah', resolution: 'auto-resolved' };
  const data = {
    applications: { palantir: { listingId: 'palantir', status: 'awaiting-user-input', questions: [question], ...overrides } },
    reviewItems: [{ id: 'review', listingId: 'palantir', questionId: question.id, question: question.prompt,
      answerUsed: question.answer, clarificationPrompt: 'How do you pronounce Adamya Singh?', confidence: 0,
      company: 'Palantir', role: 'Software Engineer New Grad', status: 'pending' }],
  } as unknown as JobApplicationsViewData;
  const markup = renderToStaticMarkup(React.createElement(exports.ApplicationReviewPanel, {
    applications: data, onCancel: async () => {}, onResolve: async () => {},
  }));
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes('Leave blank'));
}

test('optional pronunciation reviews offer an enabled Leave blank button; required fields do not', () => {
  const button = blankButton(false);
  assert.ok(button);
  assert.equal(button.includes('disabled='), false);
  assert.match(button, /clear this optional field/);
  assert.equal(blankButton(true), undefined);
});

test('submitted, closed and actively submitting reviews do not offer Leave blank', () => {
  assert.equal(blankButton(false, { status: 'submitted' }), undefined);
  assert.equal(blankButton(false, { status: 'closed' }), undefined);
  const now = Date.now();
  assert.equal(blankButton(false, { submissionAttemptedAt: new Date(now - 60000).toISOString(),
    lease: { token: 'live', claimedAt: new Date(now - 300000).toISOString(), expiresAt: new Date(now + 300000).toISOString() } }), undefined);
});
