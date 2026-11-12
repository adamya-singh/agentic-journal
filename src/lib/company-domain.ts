// Which web domain to fetch a company's logo from. The interviews index keeps a
// curated company → domain map; otherwise a posting hosted on the company's own
// site gives its domain away. Applicant-tracking and job-board hosts never do:
// jobs.ashbyhq.com/acme would fetch Ashby's logo, so those are skipped.

const HOSTED_ELSEWHERE = [
  'ashbyhq.com', 'greenhouse.io', 'myworkdayjobs.com', 'myworkdaysite.com', 'lever.co', 'jobright.ai', 'simplify.jobs',
  'linkedin.com', 'workable.com', 'breezy.hr', 'icims.com', 'smartrecruiters.com', 'rippling.com', 'welcometothejungle.com',
  'jobvite.com', 'bamboohr.com', 'recruitee.com', 'dover.com', 'ycombinator.com', 'wellfound.com', 'indeed.com',
  'glassdoor.com', 'handshake.com', 'joinhandshake.com', 'gem.com', 'teamtailor.com', 'pinpointhq.com', 'oraclecloud.com',
  'taleo.net', 'successfactors.com', 'paylocity.com', 'adp.com', 'ultipro.com', 'jazzhr.com', 'applytojob.com',
  'speedyapply.com', 'github.com', 'google.com', 'notion.site', 'notion.so',
];

const SUBDOMAIN_PREFIX = /^(www|jobs|careers|career|apply|join|work|hire|boards|job-boards|campus[\w-]*)\./;

export function domainFromLink(link: string | undefined): string | undefined {
  let host: string;
  try {
    host = new URL(link ?? '').hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host)) return undefined;
  if (HOSTED_ELSEWHERE.some((ats) => host === ats || host.endsWith(`.${ats}`))) return undefined;
  while (SUBDOMAIN_PREFIX.test(host) && host.split('.').length > 2) host = host.replace(SUBDOMAIN_PREFIX, '');
  return host;
}

export function companyDomain(
  company: string,
  link: string | undefined,
  domains: Record<string, string>,
): string | undefined {
  return domains[company.trim().toLowerCase()] ?? domainFromLink(link);
}
