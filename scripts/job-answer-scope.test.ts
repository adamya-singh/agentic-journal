import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextReason, defaultAnswerScope } from '../src/lib/job-answer-scope';

test('questions whose answer depends on the job default to context', () => {
  const context = [
    { prompt: 'How did you hear about this opportunity? (select all that apply)', answer: ['Notion Website'], company: 'Notion' },
    { prompt: 'Where did you hear about this opportunity?', answer: 'Jobright' },
    { prompt: 'How did you find out about this opportunity?', answer: 'SimplifyJobs' },
    { prompt: 'Please tell us how you heard about this opportunity.', answer: 'Other' },
    { prompt: 'Referral source', answer: 'LinkedIn' },
    { prompt: 'Why do you want to work at Notion?', answer: 'AI makes it possible…', company: 'Notion' },
    { prompt: 'Why are you interested in this role, and what makes you a good fit?', answer: 'I like…' },
    { prompt: 'Why Applied Intuition?', answer: 'Physical AI', company: 'Applied Intuition' },
    { prompt: 'What excites you about our mission?', answer: 'Robots' },
    { prompt: 'Which location are you applying for?', answer: 'San Diego, California' },
    // A generic prompt answered for one company.
    { prompt: 'Additional Information', answer: 'I would love to build Clay’s enrichment agents.', company: 'Clay' },
  ];
  for (const input of context) assert.equal(defaultAnswerScope(input), 'context', input.prompt);
});

test('facts about Adamya stay general', () => {
  const general = [
    { prompt: 'Are you authorized to work lawfully in the United States?', answer: 'Yes', company: 'Notion' },
    { prompt: 'Will you now or in the future require sponsorship?', answer: 'No' },
    { prompt: 'Email*', answer: 'adamya.singh@rutgers.edu' },
    { prompt: 'Why are you looking for new opportunities?', answer: 'I graduate in January 2027.' },
    { prompt: 'If referred by an employee, please provide their name.', answer: 'N/A' },
    // Naming the company already keeps a prompt to that company's forms.
    { prompt: 'Have you worked at Snowflake in the past?', answer: 'No', company: 'Snowflake' },
    { prompt: 'Disability Status', answer: 'No', company: 'X' },
    { prompt: 'This role is only open to candidates who have completed their degree. Does this apply to you?', answer: 'No' },
  ];
  for (const input of general) assert.equal(defaultAnswerScope(input), 'general', input.prompt);
  assert.equal(contextReason(general[0]), null);
});
