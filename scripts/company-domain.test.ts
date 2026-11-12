import assert from 'node:assert/strict';
import { test } from 'node:test';
import { companyDomain, domainFromLink } from '../src/lib/company-domain';

test('a posting on the company site gives its domain', () => {
  assert.equal(domainFromLink('https://www.tesla.com/careers/search/job/123'), 'tesla.com');
  assert.equal(domainFromLink('https://amazon.jobs/en/jobs/10490741'), 'amazon.jobs');
  assert.equal(domainFromLink('https://jobs.apple.com/en-us/details/1'), 'apple.com');
  assert.equal(domainFromLink('https://apply.careers.microsoft.com/careers/job/1'), 'microsoft.com');
  assert.equal(domainFromLink('https://sierra.ai/careers/x'), 'sierra.ai');
});

test('applicant-tracking and job-board hosts never stand in for the company', () => {
  for (const link of [
    'https://jobs.ashbyhq.com/acme/1',
    'https://job-boards.greenhouse.io/acme/jobs/1',
    'https://job-boards.eu.greenhouse.io/acme/jobs/1',
    'https://nvidia.wd5.myworkdayjobs.com/en-US/x',
    'https://jobright.ai/jobs/info/1',
    'https://www.linkedin.com/jobs/view/1',
    'https://bitdeer.breezy.hr/p/1',
    'not a url',
    '',
  ]) assert.equal(domainFromLink(link), undefined, link);
});

test('the curated map wins over the link', () => {
  assert.equal(companyDomain('NVIDIA', 'https://jobs.nvidia.com/x', { nvidia: 'nvidia.com' }), 'nvidia.com');
  assert.equal(companyDomain('Acme', 'https://jobs.ashbyhq.com/acme', {}), undefined);
});
