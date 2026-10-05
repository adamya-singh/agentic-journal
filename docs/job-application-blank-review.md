# Leave an optional application field blank

On `/jobs`, optional questions in **Review OpenClaw’s answer choices** offer **Leave blank** beside Confirm/Correct and inside the correction editor. Required questions, action blockers, submitted/closed applications, and live submissions do not offer this action.

`POST /api/jobs/applications/reviews` accepts `{ reviewId, action: "leave-blank" }`. It atomically clears the current answer, suggestion and eligibility approval, sets the question resolution to `skipped`, and resolves its review as `left-blank`. Historical generated-answer and screenshot evidence remain for provenance. No reusable answer-bank entry is created. Resolving the final review releases the normal review hold and wakes the worker; an earlier blank preserves the remaining hold.

Rediscovery retains the explicit skipped resolution and absent answer. The OpenClaw application skill and contract instruct the worker to clear previously drafted/autofilled values after autofill, verify the control is empty before screenshots/submission, and request input if the employer now requires it.

Validation covers durable state, rediscovery, answer-bank isolation, hold release, atomic rejection for required and terminal/in-flight cases, client requests/state, and the actual rendered optional-field control.
