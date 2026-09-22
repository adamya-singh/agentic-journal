const base = process.env.AGENTIC_JOURNAL_URL || 'http://127.0.0.1:3000';
const response = await fetch(`${base}/api/jobs/overview/analysis`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ force: false }),
  signal: AbortSignal.timeout(120000),
});
if (!response.ok) throw new Error(`Analysis endpoint returned ${response.status}`);
console.log(
  JSON.stringify({ success: true, generatedAt: (await response.json()).report?.generatedAt }),
);
