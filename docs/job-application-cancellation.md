# Cancel an application during answer review

On `/jobs`, each unsubmitted application in **Review OpenClaw’s answer choices** has a **Cancel application** action. It opens an inline reason form with Outside the US, PhD only, and Not a fit suggestions; the user can edit the reason or write their own. **Keep application** closes the form. The reason is required and limited to 2,000 characters.

`POST /api/jobs/applications/reviews` accepts `{ action: "cancel-application", listingId, reason }`. The atomic application-store transaction:

- closes the application and records `cancelledAt`, `closedAt`, and the trimmed explanation in `closedReason`;
- dismisses its pending reviews without confirming answers or updating the answer bank;
- clears review/autopilot scheduling, retry and resume requests, and worker progress;
- invalidates the worker lease and marks any unfinished screenshot capture failed.

Closed applications cannot be claimed, including after the review deadline. Worker updates using the old lease are rejected. The cancellation returns the same committed review-result shape as answer confirmation and patches the UI immediately, followed by a silent count refresh. Existing submitted or closed applications, and applications with a submission attempt in the currently active worker lease, reject cancellation with 409. This does not withdraw a submitted employer application.

The cancelled application stays in the Board’s Closed view. Its application detail displays **Cancelled by you**, the cancellation time, and the reason. The reason applies to this application; it does not automatically create a global job-search filter.

Validation: application-route tests exercise reason validation, durable dismissal and explanation, no answer-bank changes, lease invalidation, terminal claim exclusion, stale worker updates, repeated cancellation, and submission protection. Review-client tests check the listing-scoped request and error handling.

Historical submission-attempt timestamps on stalled drafts do not hide or disable cancellation. The control stays visible for unsubmitted applications; it is disabled only while the current active lease is completing a submission.
