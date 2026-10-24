// The 2025–26 recruiting season, from OpenClaw's ~/.openclaw/workspace/interviews/
// folders (kept before Jobs existed). Dates, people and rounds come from each
// folder's dates.md; questions and answers from the round notes and transcripts.
// Used once by `node scripts/interviews.ts import-2025-26`.

type Kind = 'screen' | 'oa' | 'tech' | 'ml' | 'behav' | 'fit' | 'onsite' | 'other';
type NoteKind = 'job-description' | 'prep' | 'notes' | 'transcript' | 'oa' | 'post-mortem' | 'outcome' | 'offer' | 'emails' | 'file';
type Ev = 'applied' | 'oa' | 'invite' | 'screen' | 'interview' | 'offer' | 'rejected' | 'note';

export interface ImportProcess {
  slug: string;
  folder: string;
  company: string;
  role: string;
  term: string;
  location: string;
  outcome: { kind: 'offer' | 'rejected' | 'no-reply'; at: string; note: string };
  people: { name: string; role: string }[];
  rounds: { id: string; name: string; kind: Kind; at: string; time?: string; duration?: string; people?: string[]; format?: string; note?: string; cancelled?: boolean }[];
  events: [string, Ev, string][];
  notes: { file: string; title: string; kind: NoteKind; round: string; date: string; author?: 'openclaw'; talkYou?: string }[];
  flags?: { id: string; text: string; options: { label: string; roundId: string; at: string }[] }[];
}

export const PROCESSES: ImportProcess[] = [
  {
    slug: 'amazon-sde-intern', folder: 'amazon-sde-intern-interview', company: 'Amazon', role: 'SDE Intern', term: 'Summer 2026', location: 'Seattle, WA',
    outcome: { kind: 'rejected', at: '2026-04-07', note: 'Standard rejection five days after the second interview day.' },
    people: [],
    rounds: [
      { id: 'oa', name: 'Online assessment', kind: 'oa', at: '2026-03-03', note: 'OA invite. No notes kept.' },
      { id: 'r1', name: 'Interview day 1', kind: 'behav', at: '2026-04-01', format: 'Behavioral + LeetCode' },
      { id: 'r2', name: 'Interview day 2', kind: 'tech', at: '2026-04-02', format: 'Behavioral + LeetCode' },
    ],
    events: [['2025-10-27', 'applied', 'Applied'], ['2026-03-03', 'oa', 'Online assessment received'], ['2026-03-19', 'invite', 'Interview request email'], ['2026-03-25', 'invite', 'Scheduling email'], ['2026-04-01', 'interview', 'Interview day 1'], ['2026-04-02', 'interview', 'Interview day 2'], ['2026-04-07', 'rejected', 'Rejected · generic email']],
    notes: [
      { file: 'amazon-sde-intern-job-description.md', title: 'Job description', kind: 'job-description', round: 'before', date: '2025-10-27' },
      { file: 'round-1-behavioral-and-leetcode-interview.md', title: 'Day 1 · behavioral + Course Schedule', kind: 'notes', round: 'r1', date: '2026-04-01' },
      { file: 'round-2-behavioral-and-leetcode-interview.md', title: 'Day 2 · TTL cache + troubleshooting', kind: 'notes', round: 'r2', date: '2026-04-02' },
      { file: 'outcome.md', title: 'Outcome', kind: 'outcome', round: 'after', date: '2026-04-07' },
    ],
  },
  {
    slug: 'moodys-swe-intern', folder: 'moodys-swe-intern', company: "Moody's", role: 'Software Engineer Intern', term: 'Summer 2026', location: 'New York · 7 World Trade Center',
    outcome: { kind: 'offer', at: '2026-01-27', note: 'Verbal offer by phone Jan 21; letter Jan 27. Team: Data – Engineering and Systems, manager Prabuddha Gupta.' },
    people: [{ name: 'Darragh Gallagher', role: 'Interviewer' }, { name: 'Mark Morly Tharakan', role: 'Interviewer' }, { name: 'Prabuddha Gupta', role: 'Hiring manager' }],
    rounds: [
      { id: 'r1', name: 'Round 1', kind: 'other', at: '2025-12-17', time: '10:30 AM', people: ['Darragh Gallagher', 'Mark Morly Tharakan'], note: 'No notes kept from this round.' },
      { id: 'r2', name: 'Round 2', kind: 'other', at: '2026-01-16', time: '2:30 PM', people: ['Prabuddha Gupta'], note: 'No notes kept from this round.' },
    ],
    events: [['2025-10-28', 'applied', 'Applied'], ['2025-12-10', 'invite', 'Round 1 scheduling request'], ['2025-12-17', 'interview', 'Round 1 · 10:30 AM'], ['2026-01-12', 'invite', 'Round 2 scheduling request'], ['2026-01-16', 'interview', 'Round 2 · 2:30 PM'], ['2026-01-21', 'offer', 'Verbal offer by phone'], ['2026-01-27', 'offer', 'Offer letter by email']],
    notes: [
      { file: 'moodys-swe-intern-job-description.md', title: 'Job description', kind: 'job-description', round: 'before', date: '2025-10-28' },
      { file: 'Moodys_Offer_Letter-summary.md', title: 'Offer letter summary', kind: 'offer', round: 'after', date: '2026-01-27' },
      { file: 'Moodys_Offer_Letter_-_Adamya_Singh_eSignatu.pdf', title: 'Offer letter (signed PDF)', kind: 'file', round: 'after', date: '2026-01-27' },
    ],
  },
  {
    slug: 'scale-ai-technical-advisor-intern', folder: 'scale-ai-technical-advisor-intern-prep-2-6-26', company: 'Scale AI', role: 'Technical Advisor Intern', term: 'Summer 2026', location: 'San Francisco, CA',
    outcome: { kind: 'no-reply', at: '2026-02-06', note: 'Nothing came back after the recruiter screen.' },
    people: [],
    rounds: [{ id: 'screen', name: 'Recruiter screen', kind: 'screen', at: '2026-02-06', time: '10:00 AM' }],
    events: [['2025-12-30', 'applied', 'Applied'], ['2026-02-04', 'invite', 'Recruiter screen request'], ['2026-02-06', 'screen', 'Recruiter screen · 10 AM']],
    notes: [{ file: 'interview_prep.md', title: 'Screen prep guide', kind: 'prep', round: 'screen', date: '2026-02-06', author: 'openclaw' }],
  },
  {
    slug: 'amd-ai-design-methodology-intern', folder: 'amd-adm-intern-interview', company: 'AMD', role: 'AI-Augmented Design Methodology Engineering Intern', term: 'Summer 2026', location: 'Austin, TX',
    outcome: { kind: 'rejected', at: '2026-03-03', note: 'Final round cancelled about two hours before it started: "looking for candidates with more experience."' },
    people: [{ name: 'Samuel Carlson', role: 'Interviewer · AI team' }, { name: 'Oleg Petlin', role: 'Final round (cancelled)' }],
    rounds: [
      { id: 'screen', name: 'Phone screen', kind: 'screen', at: '2026-01-24', note: 'No notes kept.' },
      { id: 'r1', name: 'Round 1', kind: 'fit', at: '2026-02-27', people: ['Samuel Carlson'], format: 'Fit + AI workflow conversation' },
      { id: 'r2', name: 'Final round', kind: 'tech', at: '2026-03-03', time: '3:00 PM', people: ['Oleg Petlin'], cancelled: true },
    ],
    events: [['2026-01-16', 'applied', 'Applied'], ['2026-01-24', 'screen', 'Phone screen'], ['2026-02-25', 'invite', 'Availability request'], ['2026-02-27', 'interview', 'Round 1 with Samuel Carlson'], ['2026-03-03', 'rejected', 'Final round cancelled · rejected']],
    notes: [
      { file: 'ai-augmented-design-methodology-engineering-intern-job-description.md', title: 'Job description', kind: 'job-description', round: 'before', date: '2026-01-16' },
      { file: 'round-1-interview.md', title: 'Round 1 · summary and transcript', kind: 'transcript', round: 'r1', date: '2026-02-27' },
      { file: 'recalibrating-signal-and-outcome.md', title: 'Post-mortem: recalibrating signal', kind: 'post-mortem', round: 'after', date: '2026-03-03' },
    ],
  },
  {
    slug: 'figma-swe-intern', folder: 'figma-swe-intern-process', company: 'Figma', role: 'Software Engineer Intern', term: '2026', location: 'San Francisco, CA',
    outcome: { kind: 'rejected', at: '2026-02-02', note: 'Intern headcount filled before scheduling.' },
    people: [{ name: 'Jaelyn Brown', role: 'Early Career Recruiter' }],
    rounds: [{ id: 'screen', name: 'Recruiter call', kind: 'screen', at: '2026-01-23', people: ['Jaelyn Brown'], note: 'Kickoff email with a scheduling form due in 5 business days. You followed up Feb 2; headcount was filled before a call was booked.', cancelled: true }],
    events: [['2026-01-17', 'applied', 'Applied'], ['2026-01-23', 'invite', 'Kickoff email + scheduling form'], ['2026-02-02', 'note', 'You followed up'], ['2026-02-02', 'rejected', 'Headcount filled']],
    notes: [{ file: 'interview-chance.md', title: 'Email thread with Jaelyn Brown', kind: 'emails', round: 'screen', date: '2026-01-23' }],
  },
  {
    slug: 'typeface-mle-intern', folder: 'typeface-mle-interview', company: 'Typeface', role: 'Machine Learning Engineer Intern', term: 'Summer 2026', location: 'Palo Alto, CA · hybrid',
    outcome: { kind: 'rejected', at: '2026-03-20', note: 'Three days after the ML breadth round.' },
    people: [{ name: 'Li Dong', role: 'MLE · coding round' }, { name: 'Gaurush Hiranandani', role: 'Senior staff applied scientist' }],
    rounds: [
      { id: 'oa', name: 'CoderPad OA', kind: 'oa', at: '2026-03-08', format: '3Sum · Longest Consecutive Sequence' },
      { id: 'screen', name: 'Recruiter screen', kind: 'screen', at: '2026-03-10T14:00:00-04:00', time: '2:00 PM', duration: '19 min' },
      { id: 'r1', name: 'Round 1 · coding', kind: 'tech', at: '2026-03-16T16:00:00-04:00', time: '4:00 PM', duration: '45 min', people: ['Li Dong'], format: 'CoderPad on Zoom' },
      { id: 'r2', name: 'Round 2 · ML breadth', kind: 'ml', at: '2026-03-17T13:15:00-04:00', time: '1:15 PM', duration: '54 min', people: ['Gaurush Hiranandani'] },
    ],
    events: [['2026-02-21', 'applied', 'Applied'], ['2026-03-08', 'oa', 'OA (CoderPad)'], ['2026-03-10', 'screen', 'Recruiter screen · 19 min'], ['2026-03-16', 'interview', 'Round 1 · coding with Li Dong'], ['2026-03-17', 'interview', 'Round 2 · ML breadth with Gaurush'], ['2026-03-20', 'rejected', 'Rejected']],
    notes: [
      { file: 'typeface-mle-intern-job-description.md', title: 'Job description', kind: 'job-description', round: 'before', date: '2026-02-21' },
      { file: 'typeface-OA.md', title: 'OA notes · 3Sum, Longest Consecutive', kind: 'oa', round: 'oa', date: '2026-03-08' },
      { file: 'recruiter-screen-transcript.md', title: 'Recruiter screen transcript', kind: 'transcript', round: 'screen', date: '2026-03-10', talkYou: 'Speaker 2' },
      { file: 'round-1-leetcode-interview.md', title: 'Round 1 · Kth largest, Large island', kind: 'notes', round: 'r1', date: '2026-03-16' },
      { file: 'round-2-ML-breadth-interview.md', title: 'Round 2 · ML breadth transcript', kind: 'transcript', round: 'r2', date: '2026-03-17', talkYou: 'Adamya' },
    ],
    flags: [{
      id: 'screen-date',
      text: "dates.md puts the recruiter screen on Mar 8, but the transcript is stamped Mar 10, 2:00 PM. Which is right?",
      options: [{ label: 'Mar 8', roundId: 'screen', at: '2026-03-08' }, { label: 'Mar 10', roundId: 'screen', at: '2026-03-10T14:00:00-04:00' }],
    }],
  },
];

type Q = ['behavioral' | 'coding' | 'system' | 'ml' | 'recruiter' | 'fit', string, string, string, string | null];
export const QUESTIONS: Q[] = [
  ['behavioral', 'Tell me about a time you had to make a tough tradeoff between quality and speed to hit a deadline.', 'amazon-sde-intern', 'r1', 'Aviro, Monday-to-Thursday deadline for ML training tasks. Chose breadth with toy project premises, kept depth by using data-mined bug shapes.'],
  ['behavioral', 'Describe a situation where you made a mistake that impacted your team. How did you handle it?', 'amazon-sde-intern', 'r1', 'PII transformation pipeline bug caused mode collapse. Alerted the team, found the commit, fixed, reprocessed, compared outputs, added regression tests.'],
  ['coding', 'Course Schedule (LeetCode 207 variant)', 'amazon-sde-intern', 'r1', "Topological sort with Kahn's algorithm."],
  ['behavioral', 'Explain when you had to troubleshoot a complex issue.', 'amazon-sde-intern', 'r2', "RAG retrieval returned irrelevant chunks; re-chunked by course using the data's own structure."],
  ['coding', 'Design an in-memory cache whose entries expire after a TTL.', 'amazon-sde-intern', 'r2', 'Dict of (value, expires_at) with monotonic time; lazy expiry on get; size() sweep was partial.'],
  ['system', 'Why is a cache blowing up in size bad? What if the box has 8 GB and the cache hits 9 GB?', 'amazon-sde-intern', 'r2', 'Memory pressure, swapping, GC time, then the process gets killed and the cache is lost.'],
  ['coding', 'Kth Largest Element in an Array', 'typeface-mle-intern', 'r1', 'Not optimal; mentioned a min-heap; moved on for time.'],
  ['coding', 'Making A Large Island', 'typeface-mle-intern', 'r1', 'Partial DFS labeling of islands.'],
  ['coding', '3Sum', 'typeface-mle-intern', 'oa', 'Solved.'],
  ['coding', 'Longest Consecutive Sequence', 'typeface-mle-intern', 'oa', 'Solved.'],
  ['ml', 'Could you learn without labels at all? Have you heard of clustering? Explain K-means.', 'typeface-mle-intern', 'r2', null],
  ['ml', 'Suggest algorithms for supervised learning beyond the CLIP model you mentioned.', 'typeface-mle-intern', 'r2', null],
  ['ml', 'How is an MLP built and trained? How do you add non-linearity?', 'typeface-mle-intern', 'r2', null],
  ['ml', 'How do bagging and boosting differ?', 'typeface-mle-intern', 'r2', null],
  ['recruiter', 'Are you familiar with our company?', 'typeface-mle-intern', 'screen', null],
  ['recruiter', 'Would a hybrid schedule out of Palo Alto work? Start date June 8, 12 weeks.', 'typeface-mle-intern', 'screen', null],
  ['recruiter', 'Where are you in your process with other companies? What is your timeline?', 'typeface-mle-intern', 'screen', null],
  ['recruiter', 'Will you need sponsorship now or in the future?', 'typeface-mle-intern', 'screen', null],
  ['fit', 'Where do you want to be in two years, and why this AI tooling role?', 'amd-ai-design-methodology-intern', 'r1', 'Forefront of AI adoption in software engineering; shipping production tools built by agents.'],
  ['fit', 'How do you manage context when working with AI agents?', 'amd-ai-design-methodology-intern', 'r1', 'Prompt doc in Notion, refined at the inflection points where agents go wrong.'],
  ['fit', 'Why Scale AI? Why this Technical Advisor role?', 'scale-ai-technical-advisor-intern', 'screen', 'Prepared answers in the OpenClaw prep guide.'],
  ['behavioral', 'Tell me about a surprising failure or limitation in a technical project.', 'scale-ai-technical-advisor-intern', 'screen', 'Prepared with STAR in the prep guide.'],
];

export const LESSONS: [string, string, string, string][] = [
  ['amd-ai-design-methodology-intern', '2026-03-03', 'Public profiles (LinkedIn, site) must mirror the resume before a process starts.', 'Post-mortem'],
  ['amd-ai-design-methodology-intern', '2026-03-03', 'Hope is fuel, not a goal. Focus on the output and let the outcomes sort themselves.', 'Post-mortem'],
  ['typeface-mle-intern', '2026-05-06', 'You would have landed Typeface MLE if you had followed through on LeetCode practice.', 'Your note on the daily LeetCode task'],
];

/** Company → web domain, for logos. Checked against each site's title on 2026-10-24. */
export const DOMAINS: Record<string, string> = {
  amazon: 'amazon.com', "moody's": 'moodys.com', 'scale ai': 'scale.com', amd: 'amd.com', figma: 'figma.com', typeface: 'typeface.ai',
  roadrunner: 'roadrunner.ai', 'preference model': 'preferencemodel.com', 'ellipsis labs': 'ellipsislabs.xyz', nvidia: 'nvidia.com',
  instalily: 'instalily.ai', 'cybernetic labs': 'netic.ai', citadel: 'citadel.com', confido: 'confidotech.com', snowflake: 'snowflake.com',
  'micron technology': 'micron.com', ing: 'ing.com', newrocket: 'newrocket.com', sierra: 'sierra.ai', 'true anomaly': 'trueanomaly.space',
  nuvo: 'nuvo.com', freeform: 'freeform.co', 'study.com': 'study.com', tiktok: 'tiktok.com',
};
