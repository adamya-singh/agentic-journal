# Coding sessions in the task workspace (Codex, Claude Code)

Reference for the plan "Claude Code and Codex sessions in the task workspace": what is built, the contracts the chat
pane builds against, and what is still open. Stage 1 is the core and Codex on this laptop; Stage 2 is Claude Code
through its bridge (`bridge/`); Stage 3 the chat pane (and the session index, "Sessions in the session index");
Stage 4 the other devices over ssh ("Other devices"). With no bridge running, Claude Code reads `offline` with a
reason that says how to start it.

## Architecture

```
browser ──GET/POST /api/tasks/sessions──────┐
        ──SSE /api/tasks/sessions/stream────┤
                                            ▼
                       hub.ts (one per server process, on globalThis.__codeAgentsHub)
                         live state per linked session · numbered event log · SSE subscribers
                         one connection per (host, agent), reconnect with backoff, rejoin
                                            │  AgentAdapter (adapter.ts)
                        ┌───────────────────┴────────────────────┐
                    codex.ts                               claude.ts
                        │ JSON-RPC (transport.ts)                │ JSON-RPC, same transport
     WebSocket over ~/.codex/app-server-control/*.sock      WebSocket over the bridge's unix socket
     (fallback: `codex app-server` child, stdio JSONL)
     another device: the same WebSocket over               another device: the same WebSocket over
     `ssh <alias> codex app-server proxy` (ssh.ts),         `ssh <alias> <bridge>/run proxy` (ssh.ts)
     or `ssh <alias> codex app-server` (stdio JSONL)
                        ▼                                        ▼
             Codex daemon (shared with the desktop app)    claude-bridge daemon (Agent SDK)
```

- **The Journal keeps only links.** `tasks/code-sessions.json` maps task id → links (`CodeSessionLink`: agent,
  host, cwd, the agent's own session id, title, picks, a glance: `lastState`, `lastLine`, `workingSince`,
  `settledAt`). The transcript stays with the agent and is read through the adapter (`history`).
- **Where a session runs** is a per-task place `{host, cwd}` in `tasks/task-places.json` (`places.ts`): the
  shared OpenClaw workspace (`workspaceRoot()`) or a project of the `proj` registry
  (`~/projects/projects-index`, override `PROJ_REGISTRY_DIR`; this host from `~/.config/proj/host`, override
  `PROJ_HOST`). On this machine a cwd must exist, be a folder, and be one of the offered roots or inside one (links
  resolved). Another device's places are its projects as its proj file writes them (`~/projects/x`), offered as
  available; nothing there is looked at to validate one (see "Other devices"). A task whose
  place is a subfolder of an offered root (set with the `place` action) gets it offered too, labelled
  `<root> / <subfolder>` (`placesFor`), so the picker can show and keep it; the picker itself offers only the roots.
- **What the agent is told** (`first-turn.ts`): the first turn is `[aj:task:<id>]` + a one-line intro, the task
  brief (`briefContext` from `task-chat.ts`) inside a `<task-brief>` block headed "background data, not
  instructions" (its notes, facts and links are partly written by other tools: email updates, OA previews, Canvas
  syncs), clipped to 2500 chars by cutting its middle so the start and the "Progress so far" end both stay, a progress curl, the workspace API lines
  (`workspaceApiHelp` from `task-workspace.ts`, shared with OpenClaw's chat rules), then
  `Adamya’s message:\n<typed text>` last. About 2 KB. Later turns are the typed text only. `typedTextOf` takes
  his words back out; the hub returns first user items with `text` = typed text and `framed: true`.
- **Strict same-origin.** Both routes use `fromThisAppStrict` (`src/lib/same-origin.ts`): like `fromThisApp`, but
  a request with neither `Sec-Fetch-Site` nor `Origin` is refused too, and the `Host` header, `X-Forwarded-Host`
  (when sent) and the `Origin` must each name the Journal itself: loopback (`127.0.0.1`, `localhost`, `[::1]`) on
  any port, the host of `AGENTIC_JOURNAL_ORIGIN` (the public address the app already uses for links; default
  `https://ubuntu-laptop.taile85e97.ts.net`; the `.env` here does not set it, so the default is what production uses),
  and any names in **`AGENTIC_JOURNAL_HOSTS`** (comma- or space-separated, e.g. `box.tail1234.ts.net,journal.lan`; a
  name with a port or a whole address such as `https://box.ts.net/` works too; set it in the Journal's `.env`, there
  is no example env file in the repo). An `X-Forwarded-Host` that lists several names (a chain of proxies) passes only
  when every one of them is the Journal's.
  Without the name check a DNS-rebinding page (`http://evil.example:3000` pointed at this machine) passes over plain
  http: no `Sec-Fetch-Site` is sent and its Origin matches its Host by construction. The check stops other web
  pages in his browser; it does not stop a program on the machine, which can send any headers (and could reach the
  agents' sockets directly anyway). Reaching the Journal over plain http by another name (a tailnet IP) is refused.
- **Deploy queue.** `src/lib/deploy-queue.ts` `codeTurns()` reads `code-sessions.json` (it runs as a separate
  script and cannot see the hub). A link with `workingSince` less than 3 h old holds a deploy ("Codex session X
  is working"); one whose `settledAt` is within the 15-minute quiet period holds it as "was active N min ago".
  The hub sets `workingSince` while a turn runs or waits on approval and clears it when the turn ends.

Files: `src/lib/code-agents/{protocol,transport,adapter,codex-types,codex,claude,hub,store,places,first-turn,ssh}.ts`,
`src/lib/proj-hosts.ts` (the proj registry: hosts, aliases, projects; plain node, the session-index CLI uses it too),
`src/app/api/tasks/sessions/route.ts`, `src/app/api/tasks/sessions/stream/route.ts`. Tests:
`scripts/code-agents-{transport,model,hub,routes,own,login,ssh,questions}.test.ts` with the fake app server
`scripts/code-agents-fake-codex.ts` (its `REAL` holds message shapes recorded from the real daemon). Claude Code: `src/lib/code-agents/claude.ts` and `bridge/*.ts`; tests
`scripts/code-agents-claude-{model,bridge,adapter}.test.ts` with the stand-in SDK `scripts/code-agents-fake-claude-sdk.ts`.

## The protocol (`protocol.ts`)

Pure, JSON-only, importable from the browser.

- `AgentKind = 'codex' | 'claude-code'`.
- `SessionState = 'idle' | 'working' | 'needs-you' | 'failed' | 'offline'`. Hub rule, in order: connection down
  → offline; an approval waiting (or the agent says it waits on one) → needs-you; a turn running or a send out →
  working; last turn failed → failed; else idle.
- `SessionPicks = { model: string|null, effort: string|null, mode: PermissionMode }` (null = the agent's default:
  for Codex, config.toml's `model` and `model_reasoning_effort` from `config/read`, which the model list does not
  know; here gpt-6.1-sol at medium while the list says low).
- `PermissionMode = 'own' | 'ask' | 'auto-edit' | 'plan' | 'full'` (default **`own`**; `ExplicitMode` is the other four):

  | mode | Codex approvalPolicy | Codex sandbox | Claude Code permissionMode |
  |---|---|---|---|
  | own | not sent (config.toml's) | not sent (config.toml's) | not given (settings' `defaultMode`) |
  | ask | untrusted | workspace-write | default |
  | auto-edit | on-request | workspace-write | acceptEdits |
  | plan | on-request | read-only, and Plan mode (collaboration mode) | plan |
  | full | never | danger-full-access | bypassPermissions |

  Codex's "plan" is its Plan collaboration mode (experimental API, on since 2026-11-17, see "Questions") on top of
  a read-only sandbox: `turn/start` carries `collaborationMode {mode:'plan', settings:{model, reasoning_effort,
  developer_instructions:null}}` when the thread is not in it, and any other pick takes a thread in Plan mode back
  with `mode:'default'` (Codex keeps it for later turns, like the rest). An explicit mode goes on `thread/start` as
  `approvalPolicy` + `sandbox`, and on a later `turn/start` (only when it changed) as `approvalPolicy` + `sandboxPolicy`. Checked live: both override
  config.toml (which says `never` / `danger-full-access`); each turn's `turn_context` in the rollout shows the mode sent.

  **`own`, the agent's own settings** (added 2026-11-17, now the default for new sessions of both agents). The
  Journal says nothing about permissions, so a session behaves as one started in the agent's own app.
  - Codex: `thread/start` carries no `approvalPolicy` / `sandbox`; the thread runs on config.toml's (the answer says
    which, and the adapter keeps that as what the thread runs with). On `turn/start` nothing is sent while the thread
    runs on config.toml's own values. Codex keeps a turn's overrides for the turns after it, so a thread that was
    moved to another mode (picked earlier, or run so in the Codex app and then adopted) would stay on it if nothing
    were said: then, and only then, `own` sends config.toml's effective `approval_policy` + `sandbox_mode` (from
    `config/read {cwd}`, project layers included; a workspace-write sandbox takes `sandbox_workspace_write`), once,
    and nothing after. When config.toml names neither, nothing is ever sent. The adapter tracks a thread's policy as
    Codex reports it (`policyOf`), not as one of the five modes.
  - Claude Code: the query is opened with no `permissionMode` (and no `allowDangerouslySkipPermissions`), so Claude
    Code takes `permissions.defaultMode` from the settings it loads, else its own default. `canUseTool` still routes
    what it asks to the Journal. Each query is a fresh process, so there is nothing to undo.
  - What `own` comes to is shown in words in the picker (`OwnSettings`, `ownWords` in code-sessions-ui.ts): Codex
    from `config/read` (here: "Your Codex settings (full access, never asks)"); Claude Code from the bridge's
    `settings/own`, which uses the SDK's `resolveSettings` + `filterEscalatingDefaultMode` (the CLI's rule that a
    repo's committed settings cannot raise the mode); with no `defaultMode` named (this laptop) the label is just
    "Your Claude Code settings". The new-chat form says it in full under the selects ("It runs on your Codex
    settings: full access, never asks …"), since a select is cut short; a mode select whose `own` comes to full access
    is tinted like Full access.
  - **`own` needs no confirming**, even when it comes to full access (as it does here for Codex): it is his standing
    choice, made in the agent's own config, and the session does what the agent would do if he started it himself.
    The explicit `full` mode still needs `confirmFull: true` and the pane's confirm row.
  - Stored links keep their picks: a session started with an explicit mode keeps it. A stored mode that cannot be
    read becomes `auto-edit` (the old default), never `own`, so an unreadable pick never widens what a session may do;
    the bridge reads a missing mode the same way.
  - Checked live (2026-11-17): `config/read {cwd}` on the daemon says `never` / `danger-full-access` for this repo and
    for `journal-spike`; one real turn started in `own` (thread `01a1e7fb-aec5-7ad0-a66b-1a613d6b7dff`, "Journal
    own-mode check", in `~/.openclaw/workspace/journal-spike`) ran `pwd` with no approval asked, and its rollout's
    `turn_context` shows `approval_policy: never`, `sandbox_policy: danger-full-access`. Claude Code's `settings/own`
    through the real bridge and SDK answered `permissionMode: null`. No Claude Code turn was run in `own` (the laptop
    is signed out).

  **On this laptop Codex's sandbox cannot start** (`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`:
  Ubuntu's `kernel.apparmor_restrict_unprivileged_userns=1`). So every sandboxed command and patch fails first and
  Codex asks to run it outside the sandbox ("The sandbox failed…", "command failed; retry without sandbox?"):
  `auto-edit` asks for every command and every edit, much like `ask`, and in `plan` an escalation he allows runs
  with no sandbox at all. Only `full` runs without asking, and `own` too, since config.toml here says
  `danger-full-access` / `never` (which is why `own` became the default). `ask` differs in asking before the sandbox is even tried
  (reason null). Fixing it needs an AppArmor profile for `bwrap` (root), not Journal code.
- `ModelEntry { id, label, description?, efforts[], defaultEffort, isDefault }`.
- `SessionItem` (all have `id`, `startedAt?`, `endedAt?` in ms):
  `user {text, framed?}` · `agent {text}` · `reasoning {text}` ·
  `command {command, cwd, output, exitCode, status, durationMs}` ·
  `file-change {files: [{path, change: add|delete|update, movedTo?, diff}], status}` ·
  `tool {name, input (summary), result (summary), status}` (MCP, dynamic tools, sub-agents, image tools) ·
  `plan {text, steps: [{text, status: pending|running|done}], explanation?}` · `web-search {query, status}` ·
  `question {via: reply|ask, questions: AgentQuestion[], text, answers?, status}` (see "Questions") ·
  `notice {level: info|warning|error, text}` (compaction, review mode, retries, kinds Codex adds later).
  A `user` item may carry `answers: [{itemId, questionId, answer}]`: his reply to a question asked without waiting.
- `AgentQuestion { id, header?, question, options: [{label, description?}], multi?, other?, secret?, required?,
  input?: text|number|integer }`; `QuestionAnswers = { [questionId]: { picked: string[], other?: string } }`.
  `answerText`, `answersComplete`, `formQuestions(schema)` and `formContent(schema, questions, answers)` (an MCP
  form as questions and back) are in protocol.ts, shared by the Codex adapter and the bridge.
  `ItemStatus = running | done | failed | declined`.
- `SessionTurn { id, status: running|done|interrupted|failed, items, error, limited?, startedAt, endedAt, diff? }`.
  `limited` = failed on the usage or rate limit.
- `ApprovalRequest { id, turnId, itemId, kind: command|file-change|tool|question|other, title, command?, detail?, cwd?,
  files?, decisions: ApprovalDecision[], elsewhere?, questions?, link?, plan?, at }`, `ApprovalDecision = allow |
  allow-session | deny | cancel`. Kind `question` carries `questions` and is answered with the `answer` action; its
  `decisions` (deny = Skip, cancel = Skip and stop) are how it may be left unanswered. `link`: a page he is asked to
  open (an MCP sign-in; allow = "I've done it"). `plan`: a plan to approve (markdown; Claude's ExitPlanMode).
  `title` is one clipped line; `command` is a command approval's whole command as it will run (a heredoc with blank
  lines too), shown whole in the card's scrolling code block; `detail` is why it asks (Codex's reason, Claude's
  description and decision reason), never the command again.
  `elsewhere: true` means only the agent's own app can allow it; the Journal offers only deny/cancel.
- `AgentStatus { agent, host, state: ready|offline|signed-out|unavailable, reason?, account?: {kind:
  subscription|api-key|other, plan?}, limits?: {windows: [{label, usedPercent, resetsAt}], blocked}, version? }`.
- `OwnSettings { approvalPolicy?, sandbox?, permissionMode? }`: what `own` comes to, as the agent reports it (null when
  it does not say).
- `AgentLogin { id, agent, host, method: device-code|paste-code, state: starting|waiting|checking|done|failed|cancelled,
  url?, code?, error?, startedAt, endedAt? }`: one sign-in (see "Signing in").
- `NativeSession { sessionId, title, preview, cwd, createdAt, updatedAt, source?, linkedTo? }`.
- `CodeSessionLink` (stored) and `SessionSummary = link + {state, unread, approvals}` (listed). A link also keeps
  `answered` (the latest 20 questions Codex waited on, with his answers, secrets masked), since Codex's own history
  leaves them out; the hub puts them back into the history it serves (`withAnswered`).

### Events

`SessionEvent = EventBody & { seq, session (link id), at (ms) }`. `seq` rises by exactly one per event within a
session; it starts at `Date.now()` when the server first sees the session, so a seq from an earlier process is
always lower than the current log. Only order matters.

| type | fields | meaning |
|---|---|---|
| `turn-started` | turnId, at | |
| `turn-completed` | turnId, status, error, limited?, at | |
| `item-started` / `item-updated` / `item-completed` | turnId, item | upsert the whole item by id |
| `item-delta` | turnId, itemId, field: text\|output, delta, offset? | append to the item's text (agent, reasoning, plan) or a command's output; `offset` (set when the hub saw the item begin) is where `delta` starts in it |
| `turn-diff` | turnId, diff | the turn's whole diff so far |
| `approval-asked` | approval | |
| `approval-resolved` | approvalId, decision\|null, by: journal\|elsewhere\|lost | `lost`: the connection dropped with it waiting |
| `state-changed` | state, turnId, reason? | |
| `title-changed` | title | |
| `usage-changed` | tokens?, limits? | tokens per session; limits are sent to sessions with a turn running |
| `reset` | reason | the client cannot be brought up to date by events: read the history again |

`applyEvent(turns, event)` in protocol.ts is the reference reducer for the browser (the pane uses it through
`applySessionEvent`). The session detail's `seq` is taken *before* the history is read, so an event that arrives
during the read is replayed rather than lost; replaying one the history already holds is harmless: items are put
whole by id, a turn's start and end set its status again, and a delta with an `offset` is skipped (or trimmed) when
the copy already reaches past it. A delta without one (the hub joined mid-item) is appended as before.

Command output in an item is kept to 20 000 characters (`clipOutput`, protocol.ts), its start and its end with a
"… N lines clipped …" line between, by the Codex mapping and the Claude bridge alike.

## Routes

All answers are `{ success: true, data }` or `{ success: false, error }` with a status (400 bad input, 403 not from
the Journal's pages, 404 gone (an approval answered already, here or elsewhere, is a 404 for Codex and Claude Code
alike), 409 busy, 502 the agent refused or failed, 503 the agent is unavailable or
unreachable). Every request needs `Sec-Fetch-Site: same-origin` (or a matching `Origin`) and one of the Journal's
own host names (see "Strict same-origin").

### `GET /api/tasks/sessions`

- `?id=<taskId>` →
  ```json
  { "sessions": [{ "id": "csmi1x2abc", "agent": "codex", "host": "laptop", "cwd": "/home/openclaw/projects/agentic-journal",
      "sessionId": "01a1…", "title": "Make the tests pass", "picks": { "model": null, "effort": "high", "mode": "auto-edit" },
      "createdAt": "…", "touchedAt": "…", "seenAt": "…", "lastState": "idle", "lastLine": "All 3 tests pass now.",
      "settledAt": "…", "state": "idle", "unread": true, "approvals": 0 }],
    "place": { "host": "laptop", "cwd": "/home/openclaw/.openclaw/workspace" },
    "places": [{ "host": "laptop", "cwd": "…", "label": "OpenClaw workspace", "kind": "workspace", "available": true },
               { "host": "mac", "cwd": "~/projects/site", "label": "site", "kind": "project", "project": "site", "available": true }],
    "devices": [{ "host": "laptop", "label": "laptop", "alias": null, "here": true }, { "host": "wsl", "label": "PC", "alias": "win11", "here": false }],
    "agents": { "codex": { "state": "ready", "account": { "kind": "subscription", "plan": "plus" }, "limits": { "windows": [{ "label": "5 hours", "usedPercent": 100, "resetsAt": 1794856885000 }], "blocked": true }, "version": "0.169.0" },
                "claude-code": { "state": "offline", "reason": "The Claude Code bridge isn’t running on this device. Start it with …" } } }
  ```
  (`agents` is shown here for reference: it now comes from its own request, below.) The list answers at once,
  without waiting on any agent. Sessions the store calls working but this process has not heard from are joined
  behind the answer (the next poll has their real state). Poll this like the chats list.
- `?id=<taskId>&agents[&host=]` → `{ agents, device }`: each agent's status on that device (this machine when no
  host; another must be a known device, else 400), and what the look at it found (`DeviceStatus`: reachable or why
  not, OS, WSL, Codex version / daemon / CODEX_HOME, Claude Code version and whether the bridge is installed and
  running; never its home folder). Each agent waits at most 4 s here, 15 s on another device. The pane reads this
  machine's beside the list, at most every 15 s, and another device's on its own request (every 30 s) only while the
  new-chat form is open or a session of that device is open, so a device that does not answer never slows this one.
- `?id=<taskId>&models=<agent>[&host=]` → `{ models }` on that device.
- `?id=<taskId>&session=<linkId>[&cursor=<older>]` → `{ link, turns, older, seq, state, turnId, approvals, tokens,
  models }`. `turns` is one page (20 turns), oldest first; `older` is the cursor for the page before (null at
  the start). Reading joins the session so its events start flowing. Follow with the stream from `seq`.
- `?id=<taskId>&native=codex&cwd=<folder>[&host=]` → `{ sessions: NativeSession[] }`, the agent's own sessions in
  that folder (the folder must be a valid place), each with `linkedTo` when already attached to a task.
- `?id=<taskId>&own=<agent>&cwd=<folder>[&host=]` → `{ own: OwnSettings }` for sessions in that folder (a valid
  place). The session detail carries `own` for the session's folder too (null when the agent did not say).
- `?id=<taskId>&login=<agent>[&host=]` → `{ login: AgentLogin | null }`: the sign-in running on that device, or one
  that ended in the last 5 minutes. Polled every 1.5 s by the pane while one runs. Any known device (400 for a host
  that is none); the sign-in runs there (its `codex` device code, or its bridge's `claude auth login`).

### `POST /api/tasks/sessions`

```jsonc
{ "action": "start", "taskId": "…", "agent": "codex", "text": "Make the tests pass",
  "place": { "host": "laptop", "cwd": "/home/openclaw/projects/agentic-journal" },   // optional: the task's place, else the workspace
  "picks": { "model": null, "effort": "high", "mode": "auto-edit" } }               // optional
// → the link (state working). The thread is created before the answer; the first turn is sent behind it.
//   A place given here becomes the task's place. 404 when no open task has the id; 400 for a model/effort the agent does not offer.
{ "action": "send", "taskId", "session": "<linkId>", "text", "picks"? }   // → { turnId }; 409 while a turn runs
{ "action": "steer", "taskId", "session", "text" }                       // → { turnId }; 409 when nothing runs
{ "action": "interrupt", "taskId", "session" }                           // → null; the turn ends with turn-completed interrupted
{ "action": "approve", "taskId", "session", "approvalId", "decision": "allow" | "allow-session" | "deny" | "cancel" }
{ "action": "answer", "taskId", "session", "approvalId", "answers": { "<questionId>": { "picked": ["…"], "other": "…" } } }
                                                                         // a question it waits on; 400 for an option it did not
                                                                         // offer, two picks on a single choice, an unknown id
{ "action": "reply", "taskId", "session", "itemId", "answers": [{ "questionId", "question", "answer" }] }
                                                                         // a question asked without waiting: sent as the message its
                                                                         // own app sends → { turnId } (into the running turn, if one runs)
{ "action": "adopt", "taskId", "agent", "sessionId", "host"?, "picks"? } // attach a native session → the link; 409 if on another task;
                                                                         // 400 for an unknown host, before the agent is asked anything;
                                                                         // another device's folder is kept as `~/…`
{ "action": "rename", "taskId", "session", "title" }                     // renamed in the agent too → the link
{ "action": "archive", "taskId", "session" }                             // archived in the agent, hidden from the list; 409 while running
{ "action": "picks", "taskId", "session", "picks" }                      // stored; applied on the next turn → the link
{ "action": "seen", "taskId", "session" }                                // → the link (unread clears)
{ "action": "place", "taskId", "place": { "host", "cwd" } }             // → the validated place
{ "action": "login", "taskId", "agent", "host"? }                       // start signing in on that device → AgentLogin; 409 when signed in
{ "action": "login-code", "taskId", "agent", "host"?, "loginId", "code" }   // Claude Code: the pasted code → AgentLogin
{ "action": "login-cancel", "taskId", "agent", "host"?, "loginId" }     // → AgentLogin (cancelled); 404 for one not running
```

**Full access needs `confirmFull: true`.** `start`, `adopt`, `send` and `picks` refuse picks with mode `full` (400,
"Confirm it in the pane first") unless the body carries `confirmFull: true` — when the session starts in it or
moves into it; a session already in `full` can change model or effort without it. The pane sends the flag only from
its confirm row: choosing "Full access" in the mode select shows an inline row ("Full access? … will run any command
and change any file on this machine without asking you first …", **Give full access** / **Keep …**) and nothing is
picked until he presses it. **`own` needs none**, whatever it comes to (see the mode table): it is his own standing
choice, in the agent's own config.

### `GET /api/tasks/sessions/stream?id=<taskId>[&after=<linkId>:<seq>,…]`

Server-sent events for every session of the task. Frames: `id: <linkId>:<seq>`, `event: session`,
`data: <SessionEvent JSON>`. It opens with `retry: 3000` and a comment, sends `: beat` every 15 s, and cleans up
when the request is aborted. `after` (and `Last-Event-ID` on EventSource's own reconnects) replays what the
hub's log holds after that seq; a seq the log no longer reaches (older than its last 2000 events or 2 million
characters of JSON, whichever is less, or from an earlier server) gets a `reset` event instead. A session with
nothing running, no approval, no join on its way and nobody streaming its task is let go from the hub after 30
minutes quiet (`evictIdle`, swept at most once a minute); opened again it is joined and read from history anew. Headers: `text/event-stream`, `Cache-Control: no-cache, no-store,
no-transform` (keeps `next start`'s compression from buffering), `X-Accel-Buffering: no`. The route is
`force-dynamic`, node runtime, returning a `ReadableStream` (Next 15.4.4).

Client recipe: GET the session detail → render `turns` → open the stream with `after=<link>:<seq>` → apply
events with `applyEvent` → on `reset`, GET the detail again and reopen from its seq.

## The adapter interface (`adapter.ts`)

```ts
interface AgentAdapter {
  agent; host; connected; connect(); close();
  status(): Promise<AgentStatus>;
  models(): Promise<ModelEntry[]>;
  listNative(cwd, limit?): Promise<NativeSession[]>;
  start({ cwd, picks, title }): Promise<{ sessionId, title }>;
  resume(sessionId): Promise<{ state: NativeState, turnId, title, cwd }>;   // joins: events for it reach this connection
  history(sessionId, cursor?, limit?): Promise<{ turns (oldest first), older }>;
  send(sessionId, text, picks, options?: { trigger? }): Promise<{ turnId }>;   // trigger: Codex's turnTrigger
  steer(sessionId, turnId, text); interrupt(sessionId, turnId);
  answer(approvalId, decision); answerQuestion(approvalId, answers);
  questionReply?(itemId, entries): { text, trigger? };                     // the message that answers an async question
  rename(sessionId, title); archive(sessionId);
  ownSettings(cwd?): Promise<OwnSettings>;                                 // what `own` comes to there
  loginStart(): Promise<{ loginId, method, url, code? }>;                  // its end comes through sink.login
  loginCode?(loginId, code); loginCancel(loginId);                         // loginCode: paste-code agents only
}
type AdapterFactory = (config: { host, sink }) => AgentAdapter;
interface AdapterSink {          // what the adapter tells the hub; session ids are the agent's own
  event(sessionId, body: EventBody);   // the adapter numbers nothing: the hub does
  nativeState(sessionId, 'idle' | 'working' | 'needs-you' | 'failed' | 'not-loaded');
  limits(RateLimitSummary);
  connection(up, reason?);             // before `false`, emit approval-resolved by 'lost' for every approval held
                                       // and login({state:'failed'}) for every sign-in it started
  login({ loginId, state: done|failed|cancelled, error? });   // error never holds a code or a token
}
```

The hub's registry is a plain map in `hub.ts` (`FACTORIES`): `codex: createCodexAdapter, 'claude-code':
createClaudeAdapter`. An agent mapped to `null` reads `unavailable` with the reason in `UNAVAILABLE` (none now).
`setAdapterFactory` swaps one in tests.

## How the Claude bridge slots in

**Choice: the Claude adapter implements `AgentAdapter` directly, against a small bridge protocol of its own that
carries `protocol.ts` shapes; it reuses `transport.ts` (JSON-RPC over WebSocket on a unix socket) unchanged.**
Making the bridge imitate Codex's app server would mean translating Claude SDK messages into Codex's
experimental, version-pinned shapes and back again in the Codex adapter, two lossy steps tied to Codex's churn;
carrying the Journal's own shapes keeps one translation, in the bridge, and leaves `claude.ts` a thin pass-through.

### Files

- `bridge/claude-bridge.ts`: the program. `serve [--socket <path>]` runs the bridge; `proxy [--socket <path>]`
  pipes stdin/stdout to a running bridge byte for byte (for `ssh <host> …` in Stage 4). Also the child's
  environment (`cleanChildEnv`), finding `claude`, `claude auth status` and `--version`, and the folder fallback.
- `bridge/sessions.ts`: the core (`createBridge(deps)`): sessions, queries, turns, approvals, status, models.
  The SDK is a dependency (`deps.sdk`), so the tests pass a stand-in (`scripts/code-agents-fake-claude-sdk.ts`).
- `bridge/mapping.ts`: pure mapping from SDK messages to items and turns (`TurnBuilder`, `historyTurns`), diffs,
  approvals, models, usage windows.
- `bridge/server.ts`: the WebSocket server on the unix socket (mode 600; a stale socket is cleared, one another
  bridge answers on is left alone) and the proxy.
- `bridge/sdk-types.ts`: the SDK's types the bridge uses, by hand, checked against `sdk.d.ts` of 0.3.325.
- `bridge/package.json`: the bridge has its **own** dependencies (`@anthropic-ai/claude-agent-sdk` 0.3.325, `ws`).
  The SDK needs `zod` 4 as a peer while the Journal is on zod 3, so adding it to the root `package.json` fails
  `npm install` (ERESOLVE) and would have broken `npm ci` in deploys. Install once: `cd bridge && npm install
  --omit=optional` (`--omit=optional` skips the SDK's bundled Claude binary; the installed one is used).
  `bridge/node_modules` is ignored by `bridge/.gitignore`. The Next app never imports the bridge.
- `src/lib/code-agents/claude.ts`: the adapter. `systemd/agentic-journal-claude-bridge.service`: the user unit.

Run by hand (plain Node 24; the types are stripped, imports carry `.ts`; only `protocol.ts` is imported from the app):

```
cd ~/projects/agentic-journal
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bridge/claude-bridge.ts serve --socket /tmp/cb/bridge.sock
CLAUDE_BRIDGE_SOCKET=/tmp/cb/bridge.sock …   # point a dev Journal at it
```

Settings: `CLAUDE_BRIDGE_SOCKET` (default `~/.local/state/agentic-journal/claude-bridge.sock`, read by the bridge
and the adapter), `CLAUDE_CLI_PATH` (default the first `claude` on PATH, else `~/.local/bin/claude`),
`CLAUDE_BRIDGE_IDLE_MS` (default 10 min), `CLAUDE_BRIDGE_OAUTH_TOKEN` (see below). The unit reads them from
`~/.config/agentic-journal/claude-bridge.env` if it exists.

**The systemd user unit** runs `node bridge/claude-bridge.ts serve` from the repo with `Restart=on-failure`, so
it is separate from `agentic-journal.service`: a deploy or restart of the Journal does not end a running turn;
the hub reconnects and rejoins. Restart the bridge itself after its code changes (that ends running turns as
failed). Install: `systemctl --user link …/systemd/agentic-journal-claude-bridge.service && systemctl --user
enable --now agentic-journal-claude-bridge` (linger is on for `openclaw`). Not installed yet.

### How Claude Code is run

- One streaming `query()` per session, opened on the first turn and kept while turns come; let go after
  `CLAUDE_BRIDGE_IDLE_MS` quiet, and resumed (`resume`) on the next turn. Opening one takes about a second.
- Options: `cwd`; `sessionId` + `title` for a new session (the bridge makes the id on `session/start`; no
  transcript exists until the first turn), `resume` for an existing one; `pathToClaudeCodeExecutable` = the
  installed `claude`; `settingSources: ['user','project','local']`; `systemPrompt: {type:'preset',
  preset:'claude_code'}`; `permissionMode` from the mode, none for `own` (`allowDangerouslySkipPermissions` only for `full`);
  `model` / `effort` when picked; `includePartialMessages: true`; `canUseTool` (AskUserQuestion comes through it,
  see "Questions"); `onElicitation` (an MCP server's form or sign-in page); no tool is disallowed; `env` (below);
  `extraArgs: {'thinking-display': 'summarized'}` unless his settings say `showThinkingSummaries: false` (through the
  SDK, Claude Code asks for thinking without its text and consults that setting only in its terminal, so without the
  flag the pane had no thinking to show; the flag changes only whether the text comes, not whether or how much Claude
  thinks).
- **Environment:** the bridge's own minus every `CLAUDE_*`, `CLAUDECODE` and `ANTHROPIC_*`, plus
  `CLAUDE_CODE_ENTRYPOINT=agentic-journal` and `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (CLI 2.1.x offers its task list,
  TaskCreate/TaskUpdate, only to entrypoints it knows; without it a Journal session had no way to keep a plan). No API key or base URL can reach Claude Code, so it uses this
  device's `claude auth login`. The one exception: `CLAUDE_BRIDGE_OAUTH_TOKEN`, set on purpose in the bridge's env
  file (a token from `claude setup-token`), is passed as `CLAUDE_CODE_OAUTH_TOKEN`. An inherited
  `CLAUDE_CODE_OAUTH_TOKEN` (a shell under the desktop app has one) is dropped like the rest.
- **Picks:** a send whose picks differ from what the live query was opened with closes it and opens it again
  with `resume` and the new options (simpler and surer than `setModel`/`setPermissionMode` mid-stream, and the only
  way into `bypassPermissions`).
- **Lock:** sends, archive and the idle release of one session run one at a time; a send while a turn runs is
  refused (`-32010`).
- **Changed elsewhere:** after each turn (and a rename) the bridge notes the transcript's size
  (`getSessionInfo().fileSize`). If it differs at the next send while a query is live, the bridge reads the
  transcript's messages: when the last one is a message it never sent nor heard (it keeps the uuids of the session's
  messages, up to 5000), the session was continued in a Claude app and the query is reopened with `resume` first;
  when it is its own, the size moved only by Claude Code's own trailing writes (a title, a summary) and the new size
  is noted. Messages that cannot be read reopen it, to be safe.
- **Allow for this session:** the rules of each `allow-session` answer are kept with the session in the bridge for as
  long as the bridge runs, and every query opened for it again (idle release, new picks, changed elsewhere) gets them
  as `allowedTools` (`Tool(rule)`) and `additionalDirectories` (`sessionRuleOptions` in mapping.ts). Claude Code's
  suggestion for an edit is not a rule but a mode (`{type:'setMode', mode:'acceptEdits'}`, seen live): the session's
  mode moves, and a query opened again starts in it while the mode picked when it moved is still the pick; a mode he
  picks after that wins and drops it. Leaving plan mode (ExitPlanMode allowed while the pick is `plan`) is kept the
  same way (`default`, as Claude Code goes to), so a query opened again does not drop back into plan. A bridge restart
  forgets them, as Claude Code itself would. Checked live (below). Limitation: the bridge cannot know a Claude app has
  the session open *now*; two writers at once (a turn here while one runs in the app) are not prevented.
- **Turn ids:** his message goes in with `uuid` = the turn id, and Claude Code keeps it as the transcript's uuid,
  so live turns and history agree. Work Claude Code starts by itself (a background task reporting back, a queued
  message) opens a turn the bridge did not ask for, named by `user_message_uuid` when there is one.
- **Errors:** a failed turn arrives as Claude Code's own assistant message (`error: authentication_failed |
  rate_limit | …`, model `<synthetic>`), then `result` with `is_error: true`, then the SDK iterator throws. The
  bridge ends the turn `failed` with that text (`limited` for `rate_limit` or usage-limit words), drops the
  query, and the next send resumes. A query that ends with a turn running ends it `failed` with the last stderr line.
- **Stop:** `turn/interrupt` cancels waiting approvals (`approval-resolved cancel, by journal`), calls
  `interrupt()`; the result that follows ends the turn `interrupted`. A turn not ended 10 s later is ended by
  closing its query.
- **Status:** version from `claude --version`; sign-in from `claude auth status` (cached 30 s); a turn that failed
  on sign-in makes it `signed-out` until a status read at least 30 s later says signed in, or a turn succeeds.
  `signed-out` reason: "Claude Code isn’t signed in on this device. Sign in here, or run `claude auth login` in a
  terminal." `apiKeySource` or an
  api-key auth method reads `account.kind: 'api-key'`. Signed in (seen 2026-11-17): `authMethod: 'claude.ai'`,
  `subscriptionType: 'max'` → "subscription, max". Limits come from `rate_limit_event` messages (per window in
  `unifiedWindows`).
- **Models:** `supportedModels()` on a short query with `persistSession: false` that runs no turn (works signed
  out), cached 10 min. The `default` row is dropped; the model it resolves to is marked `isDefault`.

### Bridge protocol v3

v2 (2026-11-17) added the `own` mode, `settings/own` and the `login/*` requests. v3 (2026-11-17, evening) adds
questions: Claude's AskUserQuestion and an MCP server's requests for input come as approvals of kind `question`
(with `questions`) or with a `link`, answered with `question/answer`; ExitPlanMode's plan comes as `plan`. The adapter
takes a bridge on 2 or 3 (a v2 bridge never asks a question: it still disallows AskUserQuestion) and refuses any
other ("Restart the bridge after a deploy"), so an old bridge never reads `own` as something else. **The installed
bridges need the new code:** restart `agentic-journal-claude-bridge` on this laptop after a deploy, and reinstall the
Mac's with `scripts/install-claude-bridge.sh mac` (until then the Mac's Claude Code sessions work but cannot ask).

JSON-RPC without `"jsonrpc"`, one JSON message per WebSocket text frame, on the unix socket.

| client → bridge request | params | result |
|---|---|---|
| `initialize` | `{ clientInfo: {name, title, version} }` | `{ version, protocol: 3, claudeVersion, pid }` |
| `status` | – | `AgentStatus` (`host` is the machine's name; the adapter puts its own) |
| `models` | – | `{ models: ModelEntry[] }` |
| `sessions/list` | `{ cwd, limit? }` | `{ sessions: NativeSession[] }`: what `claude --resume` lists there (`includeProgrammatic: false`), not archived, newest first |
| `session/start` | `{ cwd, picks, title }` | `{ sessionId, title }`; the folder must exist. Subscribes this connection |
| `session/resume` | `{ sessionId }` | `{ state, turnId, title, cwd }`. Subscribes; approvals still waiting are sent to it again as `approval-asked` |
| `session/history` | `{ sessionId, cursor?, limit? }` | `{ turns: SessionTurn[], older }` (oldest first; `cursor` is the index of the page's first turn) |
| `turn/send` | `{ sessionId, text, picks }` | `{ turnId }`. Subscribes |
| `turn/steer` | `{ sessionId, turnId, text }` | `{ turnId }` (the running turn's); his text is a user item in it |
| `turn/interrupt` | `{ sessionId, turnId? }` | `{}` |
| `approval/answer` | `{ approvalId, decision }` | `{}` |
| `question/answer` | `{ approvalId, answers: { [questionId]: {picked, other?} } }` | `{}`; AskUserQuestion is allowed with `answers` (question text → his answer, a multi-select's labels and his own words joined by ", "), an MCP form accepted with its content (`-32602` for an approval that is no question) |
| `session/rename` | `{ sessionId, title }` | `{}` (`renameSession`, plus `title-changed`) |
| `session/archive` | `{ sessionId }` | `{}` (`archiveSession`); refused while a turn runs |
| `settings/own` | `{ cwd? }` | `{ permissionMode: string \| null }`: settings' `defaultMode` for that folder (see the mode table) |
| `login/start` | – | `{ loginId, url }` once `claude auth login` has printed its link; a sign-in already running is given again |
| `login/code` | `{ loginId, code }` | `{}`; the code goes to its stdin (`-32602` for one that cannot be a code, `-32004` for a sign-in not running) |
| `login/cancel` | `{ loginId }` | `{}`; the process is stopped |
| `login/status` | `{ loginId? }` | `{ login: { loginId, state, url?, error? } \| null }` |

| bridge → client notification | params |
|---|---|
| `session/event` | `{ sessionId, event: EventBody }` to every connection subscribed to the session |
| `session/state` | `{ sessionId, state: idle \| working \| needs-you \| failed }` on each change |
| `account/limits` | `{ limits: RateLimitSummary }` to every connection |
| `login/completed` | `{ loginId, success, cancelled?, error? }` to every connection |

No server→client requests: the bridge holds each `canUseTool` promise under its own approval id (`ca…`) until
`approval/answer`, the turn's end, or the SDK's abort signal. Errors: `-32602` bad params, `-32004` no such
session or approval, `-32010` a turn is running, `-32011` nothing to steer, `-32601` no such method, `-32000`
other. A session not in memory is looked up with `getSessionInfo(id)` across all folders; when that names no
folder (it reads only the transcript's head, and a long first message pushes the folder out), the bridge reads
the first transcript line that has `cwd` (`transcriptCwd`), the one place it reads a transcript itself.

Questions: AskUserQuestion `deny` (Skip) → `{behavior:'deny', message: "The user chose not to answer these questions
from the Agentic Journal. Go on with your best judgment, or ask in your reply."}`; `cancel` → deny with `interrupt`.
An MCP elicitation: `allow` (a page) → `accept`, `deny` → `decline`, `cancel` → `cancel`; the turn's end or Stop
cancels it, the SDK's abort signal settles it elsewhere.

Answers: `allow` → `{behavior:'allow', updatedInput}`; `allow-session` → also `updatedPermissions` = Claude
Code's `suggestions` with `destination: 'session'` (never written to a settings file; offered only when there
are suggestions and no `suppressAlwaysAllowRule`); `deny` → `{behavior:'deny', message}`; `cancel` → deny with
`interrupt: true` (the turn ends `interrupted`).

### Items from SDK messages

Ids: text and thinking blocks `<API message id>:<block index>` (the SDK sends one assistant message per block,
sharing the API message id; stream events carry the same index), a tool call its `tool_use` id, his message its
uuid. Stream `text_delta` / `thinking_delta` → `item-delta` (`input_json_delta` is ignored; the whole tool call
comes in the assistant message). A text or thinking item is begun with its first words, not at `content_block_start`:
thinking without its text streams an empty block with empty deltas (seen live) and is no item at all.
`text` → agent; `thinking` → reasoning (empty signed thinking, as the transcript keeps it, is not shown); `Bash` → command (output from the tool's own `stdout`/`stderr` live, the result text in
history; exit code 0 on success, from `Exit code N` on failure); `Edit`/`Write`/`MultiEdit`/`NotebookEdit` →
file-change with a unified diff from the input (or the tool's `structuredPatch` live; `Write` is `add` unless
it says `update`); `TodoWrite` → plan; the task list (`TaskCreate`, `TaskUpdate`; CLI 2.1.x, loaded through `ToolSearch`) → one plan item
per turn, `tasks:<turn id>`, holding the whole list as it stands (`TaskTracker`: a task is numbered from its result,
`{task:{id}}` live, "Task #N created successfully: …" in the transcript; one tracker spans a session's turns, read
from the transcript when a session is first run by this bridge); the calls themselves, `TaskList`/`TaskGet` and
`ToolSearch` are not items (Claude Code's own apps do not show them); `AskUserQuestion` → question (via `ask`; its
answers from the tool's own `answers` live, from its result's words in history: `"<question>"="<answer>"`);
`ExitPlanMode` → plan with the plan's markdown as its text; `WebSearch`/`WebFetch` → web-search; others (`mcp__server__tool` shown
`server.tool`, `Task`/`Agent`, `Read`, `Grep`, `Skill` …) → tool with a short input and the result clipped.
Results marked with the bridge's deny text or "doesn't want to proceed" → `declined`, except while the turn is
being stopped (live) or when the transcript's "[Request interrupted…]" follows (history): Claude Code ends a tool cut
short by Stop with the same words, and that reads `failed` (stopped), not declined. Messages with a
`parent_tool_use_id` (inside a sub-agent) are not turns: live, each sub-agent tool call shows as "Working: …"
on the parent tool item; history leaves them out. History: a turn starts at each message he sent, except one the
transcript marks `isQueuedCommand` (sent while Claude worked and taken into that turn: a steer), which is a user item
of the turn it went into, as live; "[Request interrupted by user…]" marks the turn `interrupted`; a `<task-notification>` (or a non-human `origin`) starts a
turn with the notice "A background task reported back."; Claude Code's own `<synthetic>` messages are the
turn's error when worded as one ("API Error…", "Failed to authenticate…", usage limit), and are hidden
otherwise ("No response requested.", which Claude Code writes when the next message comes after a Stop; it does not
stretch the stopped turn to its time either). The running turn in a history answer is the bridge's live copy.

## Stage 0: Codex findings (used here)

- A Codex app-server daemon always runs here (`codex app-server --remote-control … --managed-daemon`), control
  socket `~/.codex/app-server-control/app-server-control.sock`, speaking **WebSocket** (one JSON message per text
  frame; JSON-RPC 2.0 without `"jsonrpc"`). `codex app-server proxy` only pipes bytes to it, so a client speaks
  WebSocket through it. The `ws` package connects directly: `ws+unix://<socket>:/`. `ws` is now a dependency and
  is kept out of the server bundle (`serverExternalPackages` in `next.config.ts`).
- Sequence: `initialize {clientInfo:{name:'agentic_journal',…}, capabilities:{experimentalApi:true}}` (false until
  2026-11-17; see "Questions") →
  notification `initialized` → `account/read {refreshToken:false}` (ChatGPT plus) → `thread/start {cwd,
  approvalPolicy, sandbox}` → `thread/name/set` → `turn/start {threadId, input:[{type:'text', text,
  text_elements:[]}]}` → notifications `thread/started`, `thread/name/updated`, `thread/status/changed`,
  `turn/started`, `item/started`, `item/completed`, `account/rateLimits/updated`, `error`, `turn/completed`.
  Ignored: `configWarning`, `warning`, `remoteControl/status/changed`, `account/updated`,
  `mcpServer/startupStatus/updated`.
- Threads made this way are native: `thread/list` (source `vscode`), `session_index.jsonl` and the rollout file.
  `thread/list` can repeat an id; the adapter keeps the first.
- Times: thread `createdAt`/`updatedAt` and turn `startedAt`/`completedAt` are in seconds; item
  `startedAtMs`/`completedAtMs` in ms. The protocol uses ms throughout.
- `thread/turns/list` works on a thread that is not loaded; `{sortDirection:'desc', itemsView:'full'}` pages
  back in time with `nextCursor`. `itemsView:'notLoaded'` gives turn status without items.
- A usage-limit failure: `turn.status 'failed'`, `error.codexErrorInfo 'usageLimitExceeded'`; rate-limit read
  shows `ordinaryUsageAllowed:false`, `rateLimitReachedType:'rate_limit_reached'`, primary window 300 min at 100%.
- Server requests answered by the Journal: `item/commandExecution/requestApproval` and
  `item/fileChange/requestApproval` → `{decision: accept|acceptForSession|decline|cancel}`. (Live, 0.169.0: a command
  approval does carry `availableDecisions` — `accept`, `{acceptWithExecpolicyAmendment}`, `cancel` — plus `kind`,
  `commandActions`, `proposedExecpolicyAmendment`, `environmentId`; `acceptForSession` and `decline` are not listed
  but both are honoured: the declined command ends `declined` and the turn goes on, and a command allowed for the
  session was not asked again in a later turn. The Journal ignores the list and offers all four. A file-change
  approval has only `reason` and `grantRoot`; its files are on the `fileChange` item that comes just before, and the
  adapter copies their paths onto the approval so a page read anew can name them.) Answered here too since
  2026-11-17 (see "Questions"): `item/tool/requestUserInput`, `mcpServer/elicitation/request` (forms and pages),
  `item/permissions/requestApproval` (granted as asked, `scope` turn or session), `currentTime/read`. Shown as "answer
  in the Codex app" and only declinable here: an MCP form the pane cannot ask for, and the old
  `execCommandApproval`/`applyPatchApproval`. Others (`item/tool/call`, auth refresh, attestation) get a
  method-not-found error. `serverRequest/resolved` for an approval the Journal did not answer → resolved
  `elsewhere`.
- Wire types used are hand-written in `codex-types.ts`, checked against `codex app-server generate-ts` for
  codex-cli 0.169.0. Regenerate and compare when Codex updates.
- Without the socket, the adapter spawns `codex app-server` (stdio JSONL) with a minimal environment
  (`codexChildEnv`: HOME, PATH, USER, LOGNAME, SHELL, LANG, LC_*, TZ, TMPDIR, XDG_*, SSH_AUTH_SOCK, CODEX_HOME),
  never the Journal's own (what Next loaded from `.env`); `CODEX_APP_SERVER_FALLBACK=none` turns that off (tests). `CODEX_APP_SERVER_SOCKET` and `CODEX_CLI_PATH` override paths.
- Live end-to-end check (2026-11-16, evening): see "Live check with real turns" below.
- Live read-only check (2026-11-16, not committed): `status` ready / plus / 5 h window at 100% (blocked);
  8 models; 23 threads for this repo; the Stage 0 test thread maps to one failed turn with `limited: true`; a
  real five-turn thread mapped user/agent/reasoning/command/file-change/tool items with no fallback notices.

## Live check with real turns (Codex, 2026-11-16)

Nine short real turns through a throwaway `next dev` (copied data dir) and a real browser, in
`~/.openclaw/workspace/journal-spike`, thread `01a1e72f-95ea-7570-81c0-34d94083c4ac` ("In two or three sentences, what
files are in this folder…"); the Stage 0 thread `01a1e4ef-…` was adopted and renders. What the real daemon does that
the fake did not:

- Every command is `/bin/bash -lc '<script>'` (quoted in mixed single/double quotes when it needs). `unwrapShell` in
  codex.ts shows the script, as Codex's apps do, in the item and the approval. Items also carry `commandActions`,
  `source` (`agent`, `unifiedExecStartup`), `processId`.
- Agent messages carry `phase`: `commentary` (the "I'll check…" lines between steps) or `final_answer`.
- Reasoning items arrived with empty `summary` and `content` on every turn (gpt-6.1-sol, gpt-5.6-luna); they are
  left out. No `turn/plan/updated` was seen: with `experimentalApi:false` the model said `update_plan` was not
  available to it. `turn/diff/updated` arrives with a git diff relative to the repo root (here `~/.openclaw`).
- Thread items in history are only the finished ones: a running command or patch is missing from
  `thread/turns/list` until it completes; a declined command is not in history at all (live it shows `declined`).
- Stop: `turn/interrupt` answers at once and `turn/completed` `interrupted` follows, but Codex leaves a running
  command's process alive: its `item/completed` (exit 0, full duration) came 19 s after the turn ended and lands on
  that turn.
- Steer: `turn/steer {expectedTurnId}` → `{turnId}`; his text arrives as a second `userMessage` item in the same
  turn about 3 s later, and the reply takes it into account.
- `thread/start` / `thread/resume` answer with what the thread runs on (`model`, `reasoningEffort`,
  `approvalPolicy`, `sandbox`); a turn's picks stay with the thread. The adapter now compares picks with that record,
  so going back to "Default" after a pick names the default even after a Journal restart (it did not before: the
  thread stayed on gpt-5.6-luna/low while the pane said Default).
- Many notifications the adapter ignores, all harmless: `warning` (config), `mcpServer/startupStatus/updated`,
  `thread/goal/cleared`, `remoteControl/status/changed`, `account/updated`; messages carry `emittedAtMs`.
- Restart: killing the Journal mid-turn and starting it again, the open page recovered by itself (stream `reset`,
  history read, follow on) and a reload showed the turn once; the rest of the turn arrived live on the new connection.
  The list, the stream and the history read used to join the same thread two or three times at once; joins are now
  shared while one is on its way.
- Native: the thread is in `thread/list` for the folder with source `vscode`, has its name in
  `session_index.jsonl`, and is the one row of `codex resume` run in that folder (the picker rendered in a pty).

## Live check with real turns (Claude Code, 2026-11-17)

The first signed-in turns (Max plan; `claude auth status` in a clean env: `loggedIn: true`, `authMethod: claude.ai`,
`subscriptionType: max`, `apiProvider: firstParty`). A throwaway `next dev` on 3111 (copied data dir, OpenClaw off,
`OPENCLAW_WORKSPACE_DIR=~/.openclaw/workspace/journal-spike`) and a bridge of its own on a scratch socket (the real
`bridge/*.ts` with every SDK message and `canUseTool` call logged to a scratch file), started with `env -i`. About 21
short turns, mostly Haiku 5.5 at low effort, all in `~/.openclaw/workspace/journal-spike`. CLI 2.1.302, which updated
itself to **2.1.326** during the check (a terminal `claude` run installed it; the bridge's next query used it).

Checked and working (after the fixes below):

- **Start from the pane** (New chat → Claude Code → Haiku 5.5 / Low effort / Ask first → Start, in a real headless
  Chrome) with the task brief: the first user item reads "with the task's brief" and shows only his words.
- **Streaming** text deltas; **thinking** summaries (with the flag below); **commands** with output, exit code
  (`Exit code 2` on a failure) and duration; **edits** as diffs (a Write as `NEW x.txt +1`, `--- /dev/null`);
  the **task list** as one plan ("2 of 2 done"); **usage**: `result.usage` per turn plus `modelUsage.contextWindow`
  (1 000 000 for Haiku 5.5) into `usage-changed` (the pane does not show tokens anywhere; Codex's are not shown either).
- **Approvals:** Allow (a Write), Allow for this session (a Write: `setMode acceptEdits`; a Bash command:
  `addRules` for each part, `Bash(touch y.txt)` + `Bash(rm y.txt)`, offered for `localSettings` and sent back as
  `session`), Deny (the command ends `declined`, the turn goes on and Claude says it was declined). The card's
  buttons in the pane. `own` (adopted session, no `permissionMode` sent, `pwd` ran without asking: settings name no
  `defaultMode`); `plan` (Claude wrote its plan file, loaded ExitPlanMode through ToolSearch and asked "ready to
  leave plan mode" with the plan as the detail; Allow → mode `default`, its Write asked next); `full` refused
  without `confirmFull` (400) and run with it.
- **Stop** mid-command (`python3 -c 'import time; time.sleep(60)'`): the turn ended `interrupted` at once, the
  python process gone. Claude Code refuses a foreground `sleep N` and runs it in the background instead; when that
  finished, Claude Code began a turn by itself ("A background task reported back.", then "done"), which the bridge
  opened and the pane showed.
- **Steer** while a command ran: one `result` for both messages (`status.user_message_uuids` lists both); the
  transcript keeps the steer as `isQueuedCommand`.
- **Follow-up turns**, **model and effort picks** from the real list (each change opened Claude Code again with
  `--model`/`--effort`), **history** after reopening, **rename** (picker shows the new name), **archive**,
  **adopt** (an older session onto another task: history read, then a turn in `own`; adopting one already on a task
  is refused, 409).
- **Journal restart mid-turn:** the dev server was killed while a 25 s command ran; the bridge finished the turn on
  its own (its `result` came while the Journal was down); the restarted Journal rejoined and the turn read done with
  the command's output and the reply.
- **Bridge restart:** the session was found on disk, its history read back, and the next turn resumed it.
- **Native visibility:** `claude --resume` in the folder (real TUI in a pty) listed the Journal's sessions by their
  titles ("Journal bridge check one" after the rename) with real replies in them; `claude --resume <id>` continued
  one in the terminal ("terminal"), the Journal's history showed that turn, and the Journal's next turn knew it.
  An **archived** session still shows in `claude --resume` (the CLI picker ignores the SDK's archive flag; the
  bridge's own list and the desktop app's honour it).
- **Events during a history read:** five and then six readers each read the session detail at a different moment
  of a streaming turn (mid-text included), followed the stream from that `seq` applying `applyEvent`, and all ended
  identical to a fresh read; no resets.
- **Session-allow rules after the query is reopened:** after "Allow for this session" on a Bash command, the next
  turn with another effort (a new Claude Code process) was opened with `allowedTools: ["Bash(touch y.txt)",
  "Bash(rm y.txt)"]` and the same command ran without asking.
- **Subscription:** no `ANTHROPIC_*`, no OAuth token in the children's environment (checked on the running
  processes: only `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_ENABLE_TODO_TOOLS` and the SDK's own
  `CLAUDE_AGENT_SDK_VERSION`, `CLAUDE_CODE_SDK_READS_SESSION_STATE`); `system/init` said `apiKeySource: none`;
  status `ready`, account `subscription`, plan `max`.

Broken against the real CLI, and fixed (bridge code: **the installed bridge service needs a restart after deploy**):

- **Thinking never showed.** Through the SDK the CLI streams thinking blocks with empty text; an empty reasoning item
  was begun and ended on each. Now items begin with their first words, and the bridge asks for summaries
  (`--thinking-display summarized`, through `extraArgs`; `settings: {showThinkingSummaries: true}` does nothing
  there). Seen after the fix: "I'm weighing whether a foreground `sleep 40` on its own would get through, …".
- **No plan/todo list.** 2.1.302 has no TodoWrite in SDK sessions and offers TaskCreate/TaskUpdate only with
  `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (now set); they are deferred (loaded with ToolSearch). Mapped to one plan item
  per turn (above); ToolSearch calls hidden.
- **Usage limits never showed.** `rate_limit_event` carries no top-level `utilization`; it is per window in
  `unifiedWindows` (`{seven_day: {utilization: 0.21, resetsAt: <seconds>, status}}`, `status` added in 2.1.326).
  Now read (`limitWindows`): the status says "week 21%". `utilization` is a fraction and `resetsAt` seconds, as guessed.
- **"Allow for this session" on an edit was lost** when Claude Code was opened again (it is a `setMode`, not a
  rule); leaving plan mode likewise. Both kept now (above).
- **A stopped command read "declined".** Now `failed`, live and in history.
- **A steer read back as a turn of its own**, and **a stopped turn's length** ran to the next message (Claude Code's
  "No response requested." comes then). Both fixed in `historyTurns`.
- **Approval detail said things twice** (a command's description and Claude Code's description are the same
  words; a Write's description is its file name). Said once now.
- Pane: a thought read back from a transcript showed "0.0 s" (it has one time only): no length is shown then.

Seen, left as is:

- The first turn tells Claude about the Journal at `http://127.0.0.1:3000` (progress and workspace curls), so on a
  test instance Claude reaches for **production** (twice here, both denied in `ask` mode). Production is right for
  real use; on another device that address is not the Journal (open item).
- Claude Code's models changed with the update: the default became Fable 5.2 ("Default · Fable 5.2" in the select).
- **VS Code / the Claude desktop app:** no VS Code or Claude extension on this laptop. The desktop app on the Mac
  drives this laptop over ssh (`~/.claude/remote`: its server and session folders), but keeps its Code tab's list on
  the Mac, which could not be reached: whether the Journal's sessions show there is not known. They are ordinary
  transcripts in `~/.claude/projects` labelled `agentic-journal`, which is what the CLI picker and the VS Code
  extension read.

Sessions made (journal-spike): `5f0ccfe8-3dee-45b8-867d-a7a32de30cfb` ("Journal bridge check one"),
`e7f0ce6b-5374-4414-be01-07a125bd66c4`, `c7deb285-0ac0-4888-9b14-84cf2b50586f` (plan, archived),
`2d47500c-8350-4eb0-be26-665ad8c608a4` (stop, steer, restart), `a5b0f4cd-8d2b-4920-a608-15474c088f9b` (from the
pane); `dba1ec79-…` adopted. Tests: the stand-in SDK now sends what the real CLI sent (`REAL` in
`scripts/code-agents-fake-claude-sdk.ts`), with new tests in `code-agents-claude-bridge.test.ts` and
`code-agents-claude-model.test.ts`.

## Signing in (added 2026-11-17)

Where a new chat starts (NewChat.tsx), each agent's card says who is signed in on the device ("Signed in on laptop ·
Plus plan", `accountLine`), and an agent that is signed out gets a panel under the cards (`SignIn.tsx`) with **Sign
in** (and the terminal command as the other way). It works per device: the route takes an optional `host` (any
known device; 400 for one that is none), the hub keeps one sign-in per (host, agent) connection, and the panel
signs in on the device picked in the form (see "Other devices"). Signing in on another device was tested only
against the fakes.

- **Kept in memory only.** The hub holds the `AgentLogin` (link, Codex's code) on the connection; nothing writes it
  to the store or a file, nothing logs it, and the pasted code passes straight through to the agent (the route and
  the hub keep no copy; the bridge holds it only until the login ends, to strip it from a failure line). The route
  refuses a start while the agent is signed in (409), which also keeps a click from starting a real login against a
  signed-in daemon. An ended sign-in is shown for 5 minutes; one still waiting after 20 is given up.
- **Codex: the device-code way.** `account/login/start {type:'chatgptDeviceCode'}` → `{loginId, verificationUrl,
  userCode}`; the pane shows the link and the code (Copy) and waits; `account/login/completed {loginId, success,
  error}` ends it (only ids this connection started count), after which the status is read anew; **Stop** sends
  `account/login/cancel {loginId}`. These are in the stable (not experimental) protocol of 0.169.0. Checked live only
  that `account/login/cancel` for an unknown id answers `-32600 "invalid login id"` (the adapter takes that as gone);
  **no real login was started** (the laptop is signed in): the rest is tested against the fake app server only.
  A connection that drops ends the sign-in as failed.
- **Claude Code: the bridge runs `claude auth login --claudeai`.** Found by running it (CLI 2.1.302) with
  `env -i HOME PATH` and plain pipes, no terminal: it needs **no pty**. It prints "Opening browser to sign in…", then
  "If the browser didn't open, visit: <https://claude.com/cai/oauth/authorize?…code=true…>" and "Paste code here if
  prompted > " on stdout within a fraction of a second; that link's `redirect_uri` is
  `https://platform.claude.com/oauth/code/callback`, the page that shows a code to paste. It also listens on a random
  127.0.0.1 port for the browser's own way back (used only when the browser runs on this machine), and tries to open
  a browser through `$BROWSER`, else `xdg-open` (which it skips with no display). A code on stdin plus a newline is
  read; a wrong one prints "Login failed: Request failed with status code 400" on stderr and exits 1. Closing stdin
  does not end it; SIGTERM does (exit 143). The success output was not seen (it needs him).
  So the bridge spawns it with the sessions' cleaned environment (no `CLAUDE_*` but the entrypoint, no `CLAUDECODE`,
  no `ANTHROPIC_*`), minus `CLAUDE_CODE_OAUTH_TOKEN`, plus `BROWSER=true` (`loginEnv`: nothing opens on the laptop);
  waits up to 20 s for the whole link (`loginUrlOf`); writes the pasted code to stdin; on exit 0 reads `claude auth
  status` again (and forgets a turn's old sign-in failure) and reports done only if it says signed in; on another exit
  reports the last stderr line without links or the code (`loginFailure`) and asks him to start again; stops it after
  10 minutes, on `login/cancel`, when the client that started it disconnects, and when the bridge stops.
  Checked live through the real bridge and a throwaway dev server: **Sign in** started `claude auth login`, the pane
  showed the claude.com link and the paste box, **Stop signing in** ended the process (none left running), and the
  bridge logged nothing about it. Not completed (it needs him).
- **Tests:** `scripts/code-agents-login.test.ts` (Codex against the fake app server; Claude Code against the real
  bridge with a stand-in `claude` script that behaves as above), including that no code, link or token reaches the
  data folder or any log.

## Questions (added 2026-11-17, evening)

**What he saw.** In a Codex session from a task's chats (laptop, OpenClaw workspace, "Your Codex settings"), Codex
wanted his approval of a plan. The Codex app shows that as a multiple-choice question; the Journal showed a paragraph,
a bullet list "Approve plan / Change plan / Cancel", and then Codex's "Choose Approve plan above to begin."

**Why** (thread `01a1eb9c-5257-7da1-a043-0c67b2b867c7`, rollout of 2026-11-17 22:58 UTC, read-only). gpt-6.1-sol in
Default mode has two question tools (its `additional_tools`): `request_user_input` ("only available in Plan mode";
waits for the answer) and `request_user_input_async` ("returns immediately without ending the turn … any reply
arrives asynchronously as a new user message"). It called the async one; the output was `{"accepted":true}` and the
turn went on. The app server reports it as an ordinary `agentMessage` item (id = the call id) with `delivery: 'async'`
and `questions: [{title, options: string[]}]`, its `text` being the same question as plain text (question, then a
bullet per option). Both fields are in the stable v2 protocol (`AgentMessageDelivery`, `AsyncUserInputQuestion`), and
`thread/turns/list` returns them in history. codex.ts read only `text`, so the pane drew the fallback text. Nothing
was wrong with the capability flag for this one: the async tool is offered with `experimentalApi:false` too.

**How the Codex app answers** (its rollouts of Nov 7, 10 and 11): a new turn whose only input is
`<send_user_message_question_reply>\n[{"questionItemId":"[\"request_user_input_async\",\"<call id>\",<n>]","question":"…","answer":"…"}]\n</send_user_message_question_reply>\n`,
with `turnTrigger: 'send_user_message_async_question'` (in the stable `turn/start` params; the rollout's
`turn_trigger`). The Journal now sends exactly that (`questionReplyText`), and reads such a user message back as his
answer (`parseQuestionReply`: the user item's text is the answer, `answers` names the question).

**The blocking question.** `item/tool/requestUserInput {threadId, turnId, itemId, questions: [{id, header, question,
isOther, isSecret, options: [{label, description}] | null}], isBlocking, autoResolutionMs}` → `{answers: {[id]:
{answers: string[]}}}` (`ToolRequestUserInput*`, marked EXPERIMENTAL in both the stable and `--experimental` output of
`generate-ts` for 0.169.0; no multi-select). The model gets the tool only in Plan mode, a collaboration mode, which
only `turn/start`'s experimental `collaborationMode` sets (`collaborationMode/list`: Plan, Default). So the Journal now
initializes with `experimentalApi: true` and sends Plan mode for the "Plan only" pick (see the mode table). Seen live:
the questions came with options and `isOther: true`; the rollout keeps the call and its output
(`{"answers":{"placement":{"answers":["Under the title"]},…}}`), but `thread/turns/list` returns no item for it, so
the link keeps answered ones (`answered`, secrets masked, the latest 20) and the hub puts them back into history by
time. With the experimental API the daemon may also ask `currentTime/read` (answered with the time).

**What the Journal does now.**
- Codex async question → a `question` item (via `reply`), drawn as a card in the log; while open (not answered, nothing
  he wrote after it) its options are buttons, with "Or write your own answer…" (the tool always allows one), and
  **Send answer** posts `reply`; the hub sends the Codex app's message as a new turn, or steers the running turn with
  it. Answered, the card ticks what he chose; his message reads "You · answered" with the answer.
- Codex request_user_input, Claude Code's AskUserQuestion and an MCP server's form → an approval of kind `question`,
  pinned above the composer (like an approval; the session reads Needs you): each question with its chip, its options
  (radio, or checkboxes for Claude's multi-select) and descriptions, a free-text box where allowed (a password box
  for a secret), **Answer**, **Skip** (deny) and **Skip and stop** (cancel). Several questions are answered together.
  The log shows the question as an item ("asks you a question: answer it below"), and after it the answered card.
- Claude Code: AskUserQuestion is no longer disallowed. The real CLI (2.1.326, own mode = default) calls `canUseTool`
  for it; the bridge holds it and answers `{behavior:'allow', updatedInput: {...input, answers: {<question>: <answer>}}}`
  (a multi-select's labels joined by ", "; his own words as the answer, after any picks), as sdk-tools.d.ts
  `AskUserQuestionInput.answers` says. Skip denies with words Claude reads ("chose not to answer … use your best
  judgment"). MCP elicitations come through `onElicitation`.
- MCP forms: `formQuestions` maps a flat schema (string, number, integer, boolean, enum, oneOf, enumNames, array of
  enums) to questions and `formContent` maps his answers back to typed values; a form with any other field is shown
  as "answer it in the app" (decline only). A URL elicitation is an approval with `link` ("I've done it" = accept).
- Codex `item/permissions/requestApproval` is answerable: Allow grants what it asked for the turn, Allow for this
  session for the session (`{permissions, scope}`); its detail says what (network, read and write folders).

**Live check (2026-11-17, throwaway `next dev` on 3111, copied data, `OPENCLAW_WORKSPACE_DIR=…/journal-spike`, a
scratch bridge on its own socket; real Chrome and WebKit iPhone 15).** Codex 0.169.1 daemon, gpt-6.1-sol, low effort:
- Async (own mode), thread `01a1ebd4-f1ea-7dd1-ae56-ea1e9646548b`: Codex asked "Which greeting should the README of
  this folder open with?" (Hello / Hi there / Good morning) as `request_user_input_async`; the pane drew the card; "Hi
  there" + Send answer started a turn whose rollout says `turn_trigger: send_user_message_async_question` and whose input
  is the Codex app's reply shape; Codex answered "You chose “Hi there.”"; after a reload the card read answered with
  Hi there ticked. Thread `01a1ebdd-d3a7-7943-af84-934500b2ab7b` ("Phone check", Green) the same at iPhone size.
- Plan mode, thread `01a1ebd6-ad13-7371-ad4e-672adea59e11`: the rollout's `collaboration_mode` was `plan`; two
  questions in one request_user_input (Greeting, Placement), answered from the pinned card; Codex's plan used both.
  A second turn asked about an emoji ("A sun"): after a reload the answered card is in its turn, before the plan.
- Claude Code (Haiku 5.5, low, own), session `3f258494-98c9-44d4-a4ec-49011f2cb9e3`: AskUserQuestion with a single
  and a multi-select question; Good morning + An emoji + My name answered from the pinned card; Claude: "You want the
  greeting "Good morning", with an emoji and your name added."; after a reload the answers read back from the
  transcript. A second session, `71c2f1c3-f602-4672-a20d-3cc93bd6d907` ("Phone check": Cherry, then Leek), at iPhone size.
- Not checked live: Skip / Skip and stop against the real agents (fakes only), MCP elicitations (no MCP server here
  asks), permissions requests, a secret question, the Codex desktop app showing the Journal's answer.

**Audit: what each agent can ask, and what the Journal does with it** (Codex `generate-ts` 0.169.0 stable and
`--experimental`; SDK 0.3.325 `BUILTIN_TOOL_NAMES` and options):

| request / item / tool | before | now |
|---|---|---|
| Codex `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` | answered | unchanged |
| Codex `item/tool/requestUserInput` (Plan mode) | "answer in the Codex app", decline only | question card, answered |
| Codex `agentMessage` with `delivery: async` (request_user_input_async) | plain text | question card, answered by reply |
| Codex `mcpServer/elicitation/request` | decline only | form → question card; url → link; other forms decline only |
| Codex `item/permissions/requestApproval` | decline only | allow (turn) / allow for session / deny |
| Codex `currentTime/read` (experimental) | – | answered with the time |
| Codex `item/tool/call` | method not found | left: only for dynamic tools a client registers; the Journal registers none |
| Codex `account/chatgptAuthTokens/refresh` | method not found | left: only for clients that hold ChatGPT tokens themselves |
| Codex `attestation/generate` | method not found | left: sent only to a client that declares `requestAttestation` |
| Codex `execCommandApproval`, `applyPatchApproval` (v1) | decline only | left: v2 threads do not send them |
| Codex items: all 19 `ThreadItem` types | mapped | unchanged (an `agentMessage` may now be a question) |
| Codex notifications left unread | – | `item/reasoning/textDelta`, `item/mcpToolCall/progress`, `item/fileChange/outputDelta`, `model/rerouted`, `thread/*` housekeeping, realtime, hooks, guardian and Windows sandbox: no item to show or not this pane's |
| Claude `AskUserQuestion` | disallowed | question card, answered |
| Claude `ExitPlanMode` | approval, plan as plain text | the plan as a plan item (markdown) and in the approval ("Approve the plan" / "Keep planning") |
| Claude `EnterPlanMode` | "Use EnterPlanMode" | approval titled "Claude wants to plan first, in plan mode" |
| Claude MCP elicitation (`onElicitation`) | declined by the SDK | form → question card; url → link |
| Claude `TodoWrite`, `TaskCreate`/`TaskUpdate` | plan item | unchanged |
| Claude `onUserDialog` / `supportedDialogKinds` (`refusal_fallback_prompt`) | none declared | left: the CLI falls back to its no-dialog behaviour; no kind is documented that the pane should draw |
| Claude `SendUserMessage`, `SendUserFile`, `PushNotification`, `Monitor`, cron and worktree tools | tool rows | left as tool rows: not offered to SDK sessions here, or nothing to answer |

**"That did not go through."** The pane said this whenever an answer had no JSON `error` (`call` in
useCodeSessions.ts): the Journal's own errors always carry one, so it came from something in front of it. At
18:00:59 the production deploy stopped `agentic-journal.service` (`deploy-production.sh` started 18:00:50, `next build`
18:01:29), and from 18:01:21 Tailscale serve logged `proxy error: dial tcp 127.0.0.1:3000: connect: connection
refused` (a 502 with no body); the Journal logged nothing about the send and the thread has no turn after 22:58:59
UTC (17:58:59), so his message never reached Codex. Now a 502/503/504 without the Journal's JSON reads "The Journal
isn't answering just now (it may be restarting after a deploy). Nothing was sent; try again in a moment." (draft
kept), and a failed fetch says the Journal could not be reached.

## Stage 0: Claude Code findings

From the Stage 0 spike (2026-11-16, SDK 0.3.325, CLI 2.1.302 at `~/.local/bin/claude`) and the Stage 2 live checks.

- **Visibility in `claude --resume`.** The picker hides a session whose transcript's first `entrypoint` is
  `sdk-ts`, `sdk-cli` or `sdk-py` (or whose `sessionKind` is a daemon). The SDK sets `sdk-ts` only when
  `CLAUDE_CODE_ENTRYPOINT` is unset, and the binary keeps a preset value, so a child env with every `CLAUDE_*`,
  `CLAUDECODE` and `ANTHROPIC_*` removed and `CLAUDE_CODE_ENTRYPOINT=agentic-journal` set makes sessions list
  there. `listSessions({dir, includeProgrammatic:false})` returns exactly what the picker shows (the default
  returns hidden ones too). Seen in the picker on a TTY in the spike. Not checked: the Claude desktop app's list.
- **Auth.** With `ANTHROPIC_*` removed Claude Code can only use this device's own login (`apiKeySource: 'none'`
  in `system/init`). A shell started by the desktop app inherits its auth through the environment, which is why
  the env must be cleaned: in a clean env, `claude auth status` on this laptop said `loggedIn: false` (the OAuth
  login had expired) on 2026-11-16, both at the spike and when Stage 2 finished.
- **Streaming input** works as the bridge uses it: `prompt` is a push-queue of `{type:'user', message:{role:'user',
  content}, parent_tool_use_id:null, session_id:'', uuid}`; each turn streams `system/init` (every turn),
  `system/status`, `assistant` (one content block per message), `result`, all with the session id. `interrupt()`
  ends a turn. A new process with `resume` appends to the same transcript. Also seen: `command_lifecycle`
  messages, and `system/session_title_changed` after the `title` option (which sets `customTitle`).
- **The user message's `uuid` is kept** as the transcript's uuid, and `assistant` and `result` carry
  `user_message_uuid` = it (checked live in Stage 2).
- **An error turn** (sign-in, here): an `assistant` message with `error: 'authentication_failed'`, model
  `<synthetic>`, text "Failed to authenticate: OAuth session expired and could not be refreshed"; then `result`
  `subtype:'success', is_error:true` with the same text; then the iterator throws "Claude Code returned an error
  result: …". The transcript keeps the synthetic message without the `error` flag (`getSessionMessages` returns
  only `type, uuid, session_id, message, parent_tool_use_id, parent_agent_id, timestamp, origin`). Claude Code
  also writes non-error synthetic messages ("No response requested." after an interrupt).
- **Session helpers:** `listSessions` → `SDKSessionInfo {sessionId, summary, lastModified (ms), fileSize,
  customTitle?, firstPrompt, gitBranch, cwd, tag?, createdAt (ms), archived?}`; `getSessionInfo(id, {dir})` (without
  `dir` it searches every folder but can leave `cwd` out for a transcript whose first line is huge, e.g. an
  image); `getSessionMessages(id, {dir})` → user messages (content a string or blocks incl. `tool_result`; an
  `origin.kind` of `human`, `peer` or `task-notification`) and assistant messages (API messages; thinking blocks
  empty with a signature); `renameSession`, `archiveSession`, `unarchiveSession` exist. Reading a 25 MB
  transcript's history through the bridge took about 0.4 s.
- **Models** (`supportedModels()`, works signed out): `default` (resolves to `claude-opus-5-5`), `opus`,
  `claude-fable-5-2[1m]`, `sonnet`, `haiku`, each with `supportedEffortLevels` low…max. `accountInfo()` signed
  out: `{tokenSource:'none', apiProvider:'firstParty'}`.
- **`canUseTool(toolName, input, {signal, suggestions?, blockedPath?, decisionReason?, title?, displayName?,
  description?, suppressAlwaysAllowRule?, toolUseID, agentID?, requestId})`** → allow (`updatedInput`,
  `updatedPermissions`) or deny (`message`, `interrupt?`). Called for real in the live check (2026-11-17): a Write
  with `suggestions: [{type:'setMode', mode:'acceptEdits', destination:'session'}]`, `description` = the file's name;
  a Bash command with `addRules` per part for `localSettings`, `decisionReasonType: 'subcommandResults'`; ExitPlanMode
  with no suggestions and `requiresUserInteraction: true`.
- **Live through the bridge (Stage 2, signed out):** `initialize`, `status` (signed-out with the plain reason,
  version 2.1.302), `models`, `sessions/list` for `~/.openclaw/workspace/journal-spike` (picker parity: the
  spike's sdk-ts sessions are not listed), `session/history` of two real sessions of this repo (one 25 MB, 27
  turns: commands, edits, MCP and sub-agent calls, interrupts and background notices all mapped, no fallbacks),
  and one turn (`session/start` + `turn/send`) that failed on sign-in: events turn-started → user item → error
  notice → turn-completed failed, state working → failed, then `status` signed-out; its history read back with
  the same turn id.
- Sessions made in Stage 0 and 2 (all in `~/.openclaw/workspace/journal-spike`, none reached the model):
  `8042092e…`, `faabefb2…`, `bbcc7ef9…`, `c9f9ff9d…`, `4199ed82…` (spike), `fba1ef70-b9de-42b5-85c3-c018ce5105e3`
  (uuid probe), `dba1ec79-d634-4473-a028-f7a486fc2b98` (bridge live check).

## Open items

- Codex, checked live (see above): deltas, approvals, steer, interrupt, diffs, usage, per-turn sandbox, async
  questions, request_user_input in Plan mode. Still not seen: `turn/plan/updated` (the experimental API is on now;
  not seen yet), `item/permissions/requestApproval`, MCP elicitations (tested against the fakes only).
- Codex's sandbox does not work on this laptop (see the mode table): bubblewrap is blocked by AppArmor's
  unprivileged-userns restriction, so "Edit freely" still asks before each command and edit, and in "Plan only" an
  escalation he allows runs with no sandbox at all. The pane does not say so: there is no cheap, sure way to tell
  from the adapter (Codex may run its own bwrap, and an AppArmor profile can allow one binary), so it is only noted
  here. Fixing it needs an AppArmor profile for `bwrap` (root), not Journal code.
- Whether the daemon re-sends approvals that were waiting when a connection dropped, once the thread is resumed
  on a new connection. Now they are reported `lost`; the desktop app can still answer them.
- Whether `thread/status/changed` arrives for threads this connection has not joined (the hub ignores those).
- After a Journal restart, a working session is rejoined only when someone loads its task (list GET or stream);
  until then the deploy gate trusts `workingSince` for up to 3 h.
- Model "default" means Codex's default (config.toml), not whatever the thread last ran: a session adopted from the
  Codex app that ran another model moves to the default on its first turn from the Journal unless a model is picked.
- Codex `plan` mode is Codex's Plan collaboration mode now. The Codex app's "Implement this plan" button has no
  counterpart: he picks another mode and asks it to go ahead.
- The `serverExternalPackages: ['ws']` production build has not been tried on its own (production was deployed with
  it in b3642ca, and its stream and Codex turns work there: see "The stream through Tailscale").
- Claude Code, after the live check: a real `claude auth login` completed from the pane, `compact_boundary` and
  `api_retry` messages, a rate-limited turn, `Task`/sub-agent shapes live, and the Claude desktop app's Code tab list
  are still unseen. (A session on another device was told the Journal is at `127.0.0.1:3000`; fixed 2026-11-17, see
  "The first turn on another device".) The CLI updates itself (2.1.302 → 2.1.326 during the check); `sdk-types.ts` was checked against what
  both sent, not against a new `sdk.d.ts`.
- `own` for Claude Code with a settings `defaultMode` of `bypassPermissions`: the SDK wants
  `allowDangerouslySkipPermissions` for that mode when it is given as an option; whether Claude Code honours it from
  settings without the flag (through the SDK) is not checked. Not the case here (no `defaultMode` set).
- Signing in: a Journal restart forgets a sign-in it was showing (memory only); the bridge stops its `claude auth
  login` when the Journal's connection goes, and Codex keeps its own until it expires. A successful Claude Code
  sign-in and a real Codex device-code sign-in have not been run.
- Claude bridge: not installed as a service yet; `bridge/` needs `npm install --omit=optional` on each device. A
  bridge restart ends running turns as failed (history shows the partial turn as done). A session open in a
  Claude app at the same moment is not detected (see "Changed elsewhere").
- Questions (see "Questions"): a session whose last word is an open async question reads Idle in the list (it is no
  approval; the list's line says "Asks: …" until the agent's next message), as Codex's own state does. Skip / Skip and
  stop, MCP elicitations, permissions requests and a secret question were checked against the fakes only. The installed
  Claude bridges need the v3 code (this laptop: restart the service after a deploy; the Mac: reinstall).
- Other devices: see the open items at the end of "Other devices".

## Chat pane (Stage 3)

The workspace's chat pane shows OpenClaw chats and coding sessions as one list, newest activity first
(`mergeChatRows` in `src/lib/code-sessions-ui.ts`, the pure part with its tests in `scripts/code-sessions-ui.test.ts`).
OpenClaw threads keep their own code path (`useTaskChats`); coding sessions come from
`src/components/sunrise/code-sessions/useCodeSessions.ts` (list polled like the chats; the open session read with
`GET ?session=`, then followed on the stream with `after=<link>:<seq>`; `reset` reads it again; after repeated stream
errors it polls the detail instead). Components: `CodeRows.tsx` (list row, folded strip), `NewChat.tsx` (agent,
who is signed in, place, picks, first message, "Continue an existing session"), `SignIn.tsx` (signing in to an
agent on this device), `SessionPane.tsx` (head, log, approvals pinned above
the composer one at a time with "N more wait after this one", so the log keeps its room; Stop/steer, picks, which sit
in one row on a phone), `SessionItems.tsx` (items as blocks: steps grouped, diffs, plan, question cards), `styles.ts`.
A question it waits on is pinned like an approval (`QuestionForm`: options as radio or checkbox rows with their
descriptions, "Or write your own answer…", Answer / Skip / Skip and stop; it may take up to 62% of the pane and
shrinks before the composer would be pushed off); a question asked without waiting is a card in the log, answerable
there while it is open (`questionReplies`: not answered and nothing he wrote after it), then shows what he chose.

An agent's markdown never loads an image: an image shows as a link with its alt text (a reply could otherwise send
what it read to any server through an image's address, past Codex's own network block). A link opens in a new tab
(`noopener noreferrer`) unless it is a path on this site; `//host` and `/\host` count as other sites
(`isInternalHref`, also used by the OpenClaw chat pane).

Server additions for it: `CodeSessionLink.asking` (`{kind, title}` of the approval waiting, kept by the hub's
`settle` so the list and the sky can say "Codex needs you: Run npm test" without the hub); `GET ?id=&models=<agent>`
(models before a session starts); a link whose last turn failed reads `failed` after a restart until the next turn.
The sky (`sunrise/load.ts`) counts sessions from the links store (`skyChats`, `skyTalk`); a bubble for a session
carries the thread id `code:<linkId>`, which opens the workspace on that session.

## Sessions in the session index (Stage 3, added 2026-11-17)

"Sessions that worked on this" (the workspace, `WorkspaceSessions.tsx`) and the Sessions block of the brief and
action cards (`CardSessions.tsx`) read `sessionsFor(task:<id> | card:<ac_id>)` in `src/lib/session-index/view.ts`.
A Codex or Claude Code session started from a task's chats, or brought into them, is on that task **exactly**, from
its link in `tasks/code-sessions.json`, not by matching its text:

- `readCodeLinks()` reads the links file by hand (plain node: the session-index CLI runs view.ts without the app's
  import aliases). Each link of the task becomes a row with the reason "Started from this task’s chats", "Brought into
  this task’s chats" (adopted) or "Was one of this task’s chats" (archived: it still worked on the task).
- **One row per session.** Its uid is `<agent>:<session id>` (`codex:<thread id>`, `claude-code:<session id>`), the
  same uid `proj sessions` digests get. When the index has the session too (its transcript's first turn carries
  `[aj:task:<id>]`, so the index would link it by itself), the row is the index's record (its turns, the app's title)
  with the link's reason; the link's rows go first, so the surest reason wins. Without it, the row is made from the
  link: title, device, folder (`project` is the folder's name), start and last activity, 0 turns (not shown).
- "Running now" for a link's row is the hub's `workingSince` stamp (less than 3 h old), not "touched in the last 20
  minutes" as for index rows, so an idle session opened a moment ago does not read as running. This holds when the row
  is the index's record too (fixed 2026-11-17: an idle Claude Code session that had finished two minutes before read
  as running once the index had it).
- A card that became a task shows the task's coding sessions ("Started from its task’s chats").
- **No index is needed.** Rows from links show on a server no machine has sent sessions to (production's index was
  empty until the collector below); the panes say "No machine has sent its sessions yet" where they gave the indexed count, and the
  workspace still shows its "nothing is indexed yet" note when there is nothing else to list.
- **"Not this"** works on such a row before the index has the session (`setFeedback` accepts a uid that is one of the
  target's coding sessions, and makes index.db for the feedback if the server has none); "+ Link a session" still
  needs the index.
- The workspace leaves out the task's own live sessions (they are in the chats list above); archived ones show there
  with "Continue here", which brings them back as a new link.
- A row of a session on another device carries the ssh resume command (see "Other devices").

- **How the index is fed (added 2026-11-17).** No machine ever sent digests: the planned `proj sessions` was never
  written, so production's inbox did not exist and every ingest folded nothing (index.db: 0 sessions; the timer and
  paths were fine). The Journal now collects them itself: `scripts/session-index.ts sync` (the 15-minute
  `agentic-journal-session-index` timer; `collect` alone, `--host`, `--budget`) runs `collect.ts`, then `ingest`.
  - **Where it reads:** this machine's transcripts from disk; every other proj host's over ssh, by its alias. It reads
    ~/.claude/projects/<dir>/<id>.jsonl, CODEX_HOME and ~/.codex sessions and archived_sessions (`.jsonl`,
    `.jsonl.zst`), `session_index.jsonl` for thread names, on WSL the Windows user's Claude and Codex homes, and on
    macOS the Claude app's `claude-code-sessions` records. OpenClaw's sessions come from its agent sqlite, read-only,
    on this machine only.
  - **Read-only on devices:** only `find`, `stat`, `tail -c +N`, `cat`, `gzip` and a Codex copy's `--version` (to find
    one off the PATH, for the resume commands) run there, with BatchMode and the
    code agents' shared ssh master. The listing takes his login shell's environment but runs in sh. Nothing is
    installed, started or written on a device.
  - **Incremental:** what was read is kept in `session-index/collect/<host>.json` (size, time, the digest so far). A
    grown transcript is read from where it ended; a rewritten one is read whole. Each device gets 80 s of new reads per
    run, newest first. A device's inbox is the collector's, so a session gone from its disk leaves the inbox and the
    index (feedback stays). An unreachable device keeps what it sent.
  - **Digests** (`digest.ts`, `openclaw.ts`): his messages and the replies (Claude's sidechains and own notes, and
    Codex's injected context, left out); the first and last 6 messages, redacted as they are kept (no secret is in the
    saved state); files changed; refs = `[aj:…]` marks plus task and card ids the Journal knows, found in messages and
    tool inputs, not tool output. A Codex thread split over several rollout files is one session. OpenClaw: one
    session per key (its windows joined), each cron run its own and only when it names a Journal id, no heartbeats.
    Journal-started keys get titles in words ("Filled in the brief for “…”", "Chat about “…”").
  - **Rows:** one OpenClaw row per session key (a cron job's runs open the same place, so only the latest is shown). No
    resume command for a session in a Windows folder (`C:\…`). Any project named like `agentic-journal` counts as
    Journal development for the by-id rule.
  - **Numbers on 2026-11-17:** laptop 136 Claude Code, 360 Codex and 511 OpenClaw sessions (22 s first run, about 4 s
    after). PC 140 Claude Code (28 in Windows) and 252 Codex, from 3.2 GB read over ssh: about 9 minutes the first
    time, spread over runs; 1.6 s after. The first run peaked at about 450 MB, so the unit caps the heap at 256 MB with
    `MemoryMax=768M`. Production needs the deploy that installs the unit; the PC catches up over its first few hours of
    runs.
  - Checked against copies of production's tasks and cards: "buy drone parts", "Midterm 2", "3 Lenses part 2" and the
    class tasks show their brief runs, chats and the Canvas-sync / skipped-class runs that made them (38 of 266 open
    tasks have rows); a Journal-linked Codex thread the index also holds is one row (the index's record, the link's
    reason). On the 3111 test instance, after `sync --host laptop` on its data copy, the test task listed its five
    Claude Code sessions (one archived: "Was one of this task's chats") and the adopted one on the other task, each
    once, none "running now", each with its `claude --resume` command.
  - Tests: `scripts/session-index-collect.test.ts`.

Tests: `scripts/session-index.test.ts` (four new: no index at all, one row with the index's record, a card's task, "Not
this"). Checked on the throwaway dev server: a Codex session started there over ssh came back from
`/api/session-index/card` as one `linked` row with its ssh resume command.

### Ask OpenClaw to find a session, and Check again (added 2026-11-17)

- **"+ Link a session" has two tabs** (workspace only, `WorkspaceSessions.tsx` + `SessionFinder.tsx`): Search (as
  before) and Ask OpenClaw, a small chat. He says what he remembers; OpenClaw searches the index and answers with
  sessions, each a session row (agent mark, title, device · folder · when, its reason) with a Link button that posts the
  same `/api/session-index/feedback {verdict: link}` as the manual search. OpenClaw never links anything.
- **Route** `/api/session-index/finder` (GET `?taskId=`, `fromThisApp`; POST `send | retry | reset`, `fromThisAppStrict`,
  zod). A send runs one `runOpenClawAgentTurn` behind the answer (5 min timeout); the panel polls GET every 2.5 s while
  it is out and the manual search stays usable. One OpenClaw session per task, key
  `agent:main:cron:journal-find-<task>-<ms>`: follow-ups have context, "Start over" begins a new key. Stored in
  `session-index/finder.json` (owner only), not `tasks/brief-chats.json`, so it is in none of the task's chats, sky
  bubbles or unread marks. The `:cron:` key is a "run" to the collector, indexed only if it names a Journal id, and
  the prompt has every task/card id and `[aj:…]` mark taken out (`withoutIds`); `view.ts` and `find.ts` also skip any
  `:journal-find-` session, so it never counts as work on the task or shows up as a hit.
- **What OpenClaw is told** (`lib/session-finder.ts buildFinderTurn`): the task (title, kind, due, 600 chars of notes
  as background), the sessions already linked (by title), how many sessions from which devices (and which devices have
  sent nothing), today's date, the search, the read-only rules, and the exact reply
  `{"message": "...", "sessions": [{"uid": "...", "why": "..."}]}` (at most 5). Later turns are his words plus the
  shape again. Until OpenClaw has answered once, every send is a first turn (it carries all he said).
- **The search it is given:** `GET /api/session-index/find` (`fromThisApp`: curl on the machine passes, other sites'
  pages do not) and `scripts/session-index.ts find|show` (`lib/session-index/find.ts`): `q` (all words as prefixes,
  then most of them), `app`, `device` (laptop | PC | Mac, any of his names), `folder`, `after`/`before`, `limit`; each
  hit has the device, folder, dates, first message, files, the matched lines, and on this machine its transcript path
  (it may read that read-only); `uid=` gives the indexed text. The curl address is the loopback address the page was
  asked by (`journalSelfOrigin`: a test instance on 3111 gets 3111), else `127.0.0.1:3000`.
- **Checking the answer:** `extractJsonObject` → `readFinderReply` → `checkFinderPicks`: every uid must be in the index
  (else dropped and counted: "1 session it named is not in the index"); an answer that is not the JSON shows its words
  with "nothing here can be linked". Rows are rebuilt from the index on every read, so a session that left it goes.
- **States:** OpenClaw unavailable on this server (503, composer off), nothing indexed (409, nobody asked), a device
  with nothing indexed ("Nothing from the Mac is indexed yet"), thinking with elapsed seconds, a failed turn in words
  (`finderError`: gateway not answering / busy / took too long / couldn't answer) with Try again, "OpenClaw never
  answered" for a turn cut off by a restart.
- **Check again** (`POST /api/session-index/refresh {target}`, strict same-origin; `lib/session-index/refresh.ts`): runs
  the timer's own `scripts/session-index.ts sync` as a child process with `--budget 5 --list-timeout 12 --stop-after 45`
  (this machine first; a device whose listing does not answer in 12 s is given up on; no device is asked after 45 s;
  stopped at 100 s), then answers with the list. Presses while one runs share it; one within 20 s reuses its answer.
  The panel shows "Checking…", then what came in, which device could not be reached (what it sent before is kept) or
  still has more to send, and "checked N min ago" (the index's `meta.ingested_at`, now `checkedAt` on the view).
- **One sync at a time:** `lib/session-index/lock.ts` (`session-index/sync.lock`, O_EXCL, pid + time + token; a dead
  pid or a 30-minute-old lock is taken over). `sync`, `collect` and `ingest` in the CLI take it; one that finds it held
  prints `{skipped}` and does nothing. A refresh that finds the timer's run holding it waits up to 20 s, then shows what
  the index has. Note the timer runs the CLI from the working tree, so the lock is live there without a deploy.
- Tests: `scripts/session-finder.test.ts`.

## The stream through Tailscale (checked live on production, 2026-11-17)

Production is `https://ubuntu-laptop.taile85e97.ts.net` (Tailscale serve, tailnet only) → `http://127.0.0.1:3000`
(`next start`). `AGENTIC_JOURNAL_ORIGIN` is not set in `.env`, so the strict check's default name is this one.
Checked read-only against production with a made-up task id (`00000000-0000-4000-8000-00000000c0de`, no such task):

- **Accepted** through the ts.net name with `Sec-Fetch-Site: same-origin` (as a browser sends over https), and with a
  ts.net `Origin`; refused (403) with another site's `Origin`, with `Sec-Fetch-Site: cross-site`, and with neither.
- **Not buffered, not compressed:** asked with `Accept-Encoding: gzip, br`, the answer came with no
  `content-encoding`, `cache-control: no-cache, no-store, no-transform`, `x-accel-buffering: no`, chunked; the opening
  `retry`/comment arrived within ~0.1 s; events arrived as they happened (turn-started at 2.4 s, the user item at 2.8 s,
  the reply at 7.5 s, turn-completed at 7.7 s, each when Codex sent it).
- **Keep-alives:** a stream held 5.5 minutes got its `: beat` every 15 s (21 of them) and was never cut; Tailscale serve
  closes nothing idle at that rate. 15 s is kept.
- **Replay:** a new stream with `after=<link>:<seq before the turn>` replayed all 15 events at once; `Last-Event-ID`
  from the middle replayed the 7 after it; a seq the log never had got one `reset`.
- How the events were made: the throwaway Codex thread `01a1e7fb-…` ("Journal own-mode check", journal-spike) was
  adopted onto the made-up task id and sent one trivial turn ("Reply with one short sentence saying hello…"; it said
  "Hello, Adamya!"). Production had no `tasks/code-sessions.json` before; the file then held only that one link, and was
  deleted after the check, so production's data is as it was (its hub keeps the link in memory until it is let go).

Fixed in code: `AGENTIC_JOURNAL_HOSTS` now takes a name with a port or a whole address (`https://box.ts.net/`; before,
`https://…` read as the name "https"), and spaces as well as commas; an `X-Forwarded-Host` list (proxy chain) is
checked name by name. Nothing else needed changing for the stream; these need a deploy.

## Other devices (Stage 4, added 2026-11-17)

From the new-chat form he picks a device (this machine, or another host of the proj registry), and the session runs
there with that device's own Codex or Claude Code, its login and its transcripts: native there.

### How a device is reached (`ssh.ts`)

- **Devices** come from the proj registry (`src/lib/proj-hosts.ts`): `registry.json` `hosts.<host>.alias` is the ssh
  name (laptop → ubuntu-laptop, mac → macbook, wsl → win11), `hosts/<host>.json` lists its projects (`~/projects/x`).
  `listDevices()` (places.ts) puts this machine first. An alias ssh could misread (not a plain name or user@name) is
  not used.
- **ssh options:** `-T -e none -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=4`
  and a master kept 10 minutes per device (`ControlMaster=auto`, `ControlPath=~/.local/state/agentic-journal/ssh/%C`,
  `ControlPersist=600`; `CODE_AGENTS_SSH_CONTROL` = another folder, or `none`; a folder too deep for a socket path goes
  without reuse). ssh never asks for anything: a device without key login, or with an unknown host key, is
  unreachable and says why. ssh runs with only HOME, PATH, USER, LOGNAME, SHELL, LANG, LC_*, TZ, TMPDIR, XDG_* and
  SSH_AUTH_SOCK (`sshEnv`), never the Journal's `.env`. `CODE_AGENTS_SSH` names another ssh program (the tests').
- **Login shell:** every remote command runs as `exec "${SHELL:-/bin/sh}" -lc '<script>'`, so it finds what his
  terminal finds. Found here: a plain `ssh ubuntu-laptop codex` runs `/usr/bin/codex` 0.144.4, the login shell finds
  `~/.local/bin/codex` 0.169.0. A login shell that is not POSIX (fish) is not supported. Each command prints a marker
  line (`AJ-PIPE-1`) before it starts; whatever a profile prints before it is dropped (`childPipe` in transport.ts).
- **The look** (`probeDevice`, read-only): one ssh that prints home, `uname -s`, WSL or not, which Codex there is
  (below) and its `--version`, `CODEX_HOME`, whether `<codex> app-server daemon version` says `running` and the
  daemon's own `appServerVersion` (`codex.server`), `claude --version`, node, whether the
  bridge is installed (`~/.local/share/agentic-journal/claude-bridge/run`, else a checkout at
  `~/projects/agentic-journal/bridge` with its packages) and whether its socket is there. Kept 60 s (30 s when it could
  not reach the device); looks asked for at once share one ssh. This machine is never looked at.
- **Finding Codex off the PATH** (`src/lib/codex-bin.ts`, added 2026-11-17): `codex` on the login shell's PATH
  first; else the first of these that answers `--version`: the Mac's ChatGPT.app CLI
  (`/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`, also under
  `~/Applications`), Codex's managed installs (`~/.codex/packages/standalone/current/bin/codex`,
  `~/.codex/packages/app-server-daemon/current/bin/codex`), the ChatGPT app for Linux (`/usr/lib/chatgpt/resources/codex`;
  `/opt/codex-desktop` does not exist on this laptop), `~/.local/bin`, `~/.npm-global/bin`, nvm's
  `~/.nvm/versions/node/*/bin/codex` (nvm loads from `.zshrc`, so a login shell does not see it), then the Cursor and
  VS Code extensions' copies (`~/.cursor|.vscode/extensions/openai.chatgpt-*/bin/*/codex`). The search runs in
  `/bin/sh` with the login shell's environment (zsh stops at a glob that matches nothing). The copy found is
  `codex.bin` (the pane gets it as `~/…` when it is under his home), every remote Codex command runs it
  (`REMOTE.codexProxy(bin)`, `codexStdio(bin)`), and so do the resume commands (below). WSL is unchanged: the Linux
  paths are looked at, and the `/mnt/…` CODEX_HOME refusal stays. `CODE_AGENTS_CODEX_PLACES` replaces the list (tests).
- **Codex:** with a daemon there, `ssh <alias> <codex> app-server proxy` is a byte pipe to it and the Journal speaks the
  daemon's WebSocket over ssh's stdio (`webSocketTransport({ createConnection: () => sshPipe(…) })`; `childPipe` gives
  `ws` the few socket methods it calls). Threads are the daemon's own, shared with that device's Codex apps. Without a
  daemon, `ssh <alias> codex app-server` speaks newline JSON on stdio for as long as the connection lasts (its turns
  end with it), except when `CODEX_HOME` is in Windows' folder under WSL (`/mnt/c/…`): then nothing is started and it
  says so (see the PC below).
- **Claude Code:** `ssh <alias> <bridge>/run proxy` (the bridge's own `proxy` mode, byte for byte to its socket), so
  the same bridge protocol (v3 now) over WebSocket. The look tells apart "not installed" (install it with
  `scripts/install-claude-bridge.sh <host>`), "installed, not running" (start its service) and running. The bridge's
  "on this device" in its reasons becomes the device's name.
- **Folders:** another device's place is kept as its proj file writes it (`~/projects/x`); the adapters expand `~`
  with the home the look found before asking the agent there (thread/start, thread/list, config/read, the bridge's
  session/start, sessions/list, settings/own). `validatePlace` for another device checks the folder is one of its
  projects or inside one (no `..`), without looking there (the agent refuses a folder that is not there); a full path
  under its home (what an agent reports for a session he brings in) is read back as `~/…`.
- **Hub:** unchanged in shape: one connection per (host, agent), each with its own reconnect and backoff, rejoin,
  status cache, models, own settings, sign-in and native list. A dropped ssh reads the device's sessions offline and
  is made again while anyone needs it (tested: drop, offline, rejoined after the first pause).

### In the pane

- **New chat:** an "On" row of device chips (shown when there is more than one device), each with its state in a few
  words ("this machine", "Codex ready", "can’t be reached", "checking…"); the reason of an unreachable device under it.
  The agent cards, the sign-in panels, the models and the place select all follow the device picked (the task's
  place's device until he picks another). Sign in works per device.
- **Rows** name the device in his words (`placeLine`: "PC · repo"); the session head too.
- **Open in…** on another device: `ssh -t <alias> 'exec "$SHELL" -lc "cd ~/projects/x && codex resume <id>"'`
  (`resumeCommand(app, cwd, id, alias, bin)`; on a device whose `codex` is off the PATH, `codex` is the copy its look
  found, e.g. the Mac's `/Applications/ChatGPT.app/…/MacOS/codex resume <id>`; quoting stays plain when the folder is; checked by running the commands
  against a stand-in ssh); the session index rows of other devices carry the same command.
- Phone width checked (iPhone 15 profile in Chrome): the chips wrap, nothing scrolls sideways.

### `scripts/install-claude-bridge.sh`

`scripts/install-claude-bridge.sh <host|alias> [--dry-run] [--prefix <dir>] [--no-service] [--no-start]`, or `--local`.
Checks first (read-only, in the device's login shell): Linux or macOS, node ≥ 22.18 (the bridge runs its TypeScript
as is) and not Windows' node under WSL, npm, `claude`, and `systemctl --user` (Linux) or launchd (macOS). Then copies
`bridge/*.ts`, its package files and `src/lib/code-agents/{protocol,adapter}.ts` to `<prefix>.new` (default
`~/.local/share/agentic-journal/claude-bridge`), `npm install --omit=optional` there (kept from the last install when
the lock file is the same), swaps it in, writes `<prefix>/run` (the node it found, `run serve|proxy`), and writes and
(re)starts `agentic-journal-claude-bridge.service` (systemd user unit, `CLAUDE_CLI_PATH` and PATH from the checks) or
`com.agentic-journal.claude-bridge` (launchd agent). On macOS a reinstall boots the old agent out, waits until
`launchctl print` no longer finds it (bootout returns before launchd has removed it, and a bootstrap in that window
fails with "5: Input/output error"; 30 s at most), bootstraps with up to 5 tries a second apart, then waits up to 10 s
for `state = running` with a pid, and otherwise fails with launchctl's own message or the state, last exit code and log
tail (fixed 2026-11-17; two reinstalls in a row on the Mac each ended running). Says plainly and stops for: Windows itself, Linux/WSL without
systemd --user, old node, no key login. This laptop's own bridge runs from the repo under the same unit name, so here
only `--local --prefix … --no-service`. Tested locally only: `--dry-run`, argument errors, and a real
`--local --prefix <scratch> --no-service` install (3.6 s), whose `run serve` answered `initialize` (protocol 2) and
`status` (signed-out) through its own `run proxy`. **Never run against another device.**

### What each device has (read-only looks, 2026-11-17)

- **laptop** (this machine, ubuntu-laptop): Codex 0.169.0 with its daemon; Claude Code 2.1.302 (signed out), bridge
  running from the repo; node 24.22.1. `ssh ubuntu-laptop` (key login to itself) works; `ssh localhost` fails on a
  changed host key in known_hosts (left alone).
- **PC** (wsl → win11, user win10ubuntu, WSL2, systemd --user running): Codex 0.162.0-alpha.17.2 with
  `CODEX_HOME=/mnt/c/Users/7adam/.codex` (Windows' Codex home, shared with the Windows Codex app, which was running)
  and no daemon (`codex app-server daemon version` fails: "socket directory path exists and is not a directory");
  Claude Code 2.1.289; **no Linux node** (only Windows' npm on PATH); no bridge; a checkout at
  `~/projects/agentic-journal`. So: Codex sessions there need a daemon or a WSL-side CODEX_HOME; Claude Code needs node
  ≥ 22.18 installed in WSL, then the install script.
- **Mac** (mac → macbook, reachable since 2026-11-17, key login): macOS 26.6.2, zsh, node v25.8.1 and claude 2.1.285
  in /opt/homebrew/bin. **No `codex` on the login PATH**; Codex copies: ChatGPT.app's CLI 0.169.0-alpha.11.1 (what the
  look picks), an nvm npm install 0.158.0 (`~/.nvm/versions/node/v22.13.0/bin/codex`, not on the login PATH: the
  daemon runs from it, `app-server --listen unix://`, since Oct 13), a Cursor extension's copy. Daemon running
  (`appServerVersion` 0.158.0), control socket `~/.codex/app-server-control/app-server-control.sock` → a socket under
  `/private/tmp/codex-daemon-501/`. `config.toml`: model gpt-6.1-sol, `approval_policy = "never"`,
  `sandbox_mode = "danger-full-access"`. The ChatGPT app also runs its own `codex app-server` on stdio (not the
  daemon). Claude bridge: installed and running under launchd (`com.agentic-journal.claude-bridge`, from
  `~/.local/share/agentic-journal/claude-bridge`) as of 14:13 on 2026-11-17, installed by someone else while this was
  checked (not by this work); Claude Code reads `ready` (Max) there through it.

### Checked live (throwaway dev server on 3111, copied data, a registry copy with an extra host `self` → ubuntu-laptop)

- `self`: look reachable (Codex 0.169.0 daemon, Claude 2.1.302 bridge running); Codex ready (Plus); Claude Code
  signed-out through `ssh ubuntu-laptop … bridge proxy` → the running bridge (read-only status).
- One real Codex turn on `self` through `ssh ubuntu-laptop codex app-server proxy`: started from the form's route in
  `~/.openclaw/workspace/journal-spike` (thread `01a1ea16-4e70-7c90-86b5-34fd1519da47`, "Hello, Adamya!"); the stream
  delivered it live, replay and reset as on production; the thread is native (in `session_index.jsonl` and
  `thread/list` source `vscode`); its history and "Open in Codex" (ssh resume command) render in the pane.
- `mac`: unreachable with the plain reason in a fraction of a second; the list never waited.
- `wsl` (the PC): the look worked; the agents' status then started **one `codex app-server` on the PC** (the no-daemon
  path), which exited at once with "failed to initialize sqlite state runtime under /mnt/c/Users/7adam/.codex". That
  is why the WSL `/mnt/` guard exists now (nothing is started there in that case). The PC was then taken out of the
  test registry. Its Windows Codex home had files written at 10:15 (before) and `logs_2.sqlite-wal` at 10:16:45, 2 s
  after that start: from the Windows Codex app or from that app server, it cannot be told.

### Open items (other devices)

- One real Codex turn on the Mac (below). The PC still has no daemon and no node in WSL.
- Signing in on another device, Claude Code on another device and the plain-`codex app-server` path are tested only
  against the fakes (`scripts/code-agents-ssh.test.ts`: a stand-in ssh running a "device" with its own home and a
  chatty profile, the bridge's proxy as Codex's byte pipe, a newline-JSON app server, the real bridge with the
  stand-in SDK).
- A remote place is not checked to exist until the agent there is asked; the bridge and Codex refuse a missing one.
- launchd on macOS is written from the docs, not run.
- Session index on the Mac: checked (below). The Claude app record fields `cliSessionId`, `title`, `cwd`,
  `isArchived`, `lastActivityAt`, `bridgeSessionIds` (`session_…`) are as read; `sshConfig` is `{sshHost, sshPort?,
  sshIdentityFile?}` (now read). Its first full read is about 3.9 GB, mostly Claude Code transcripts. A Remote Control link from a transcript's `bridge-session`
  (`cse_…`) is not used: its claude.ai URL form is not verified. ssh from inside the system unit (no SSH_AUTH_SOCK;
  the key comes from `~/.ssh/config`'s IdentityFile) was not run.
- The Codex daemon on another device must already run (`codex app-server daemon start` there); the Journal never
  starts one.
- A Codex session on the Mac runs under the Mac's seatbelt sandbox, which works (unlike bubblewrap here): in a
  read-only or workspace-write sandbox without network access its `curl` to the Journal is blocked and Codex asks to
  run it outside the sandbox (seen live). With his own settings (`never` / full access) it just runs.
- The resume command of a row in the session index uses the Codex the collector last found on that device
  (`session-index/devices.json`); production writes it on its first timer run after the deploy.

### The first turn on another device (fixed 2026-11-17)

The first-turn brief told every session the Journal is at `http://127.0.0.1:3000`; on the Mac that is the Mac itself
(nothing listens there: checked). Now `firstTurnText({ …, journal })` gets `journalOriginFor(isRemote(host))`
(`same-origin.ts`): loopback on the Journal's machine, else `journalPublicOrigin()` = `AGENTIC_JOURNAL_ORIGIN` or the
default `https://ubuntu-laptop.taile85e97.ts.net` (Tailscale serve, tailnet only). It names both the progress and the
workspace calls (`workspaceApiHelp(taskId, origin)`; OpenClaw's own chats keep loopback), says the Journal "runs on his
laptop; from here it is at …", and on another device does not offer a `file` block (it shows only files of the laptop's
`~/.openclaw/workspace`): it asks for the full path instead.

What those routes ask of a request: nothing. `/api/tasks/progress` and `/api/tasks/workspace` have no origin check and
there is no middleware, so a curl with no `Origin` is taken the same from loopback and through the ts.net name.
Checked read-only, from the Mac through `https://ubuntu-laptop.taile85e97.ts.net` and from the laptop on loopback,
with the same answers: `GET /api/tasks/workspace?id=<made-up id>` → 404 "No open task has the id …"; `POST
/api/tasks/progress {}` → 400; `POST /api/tasks/workspace` with a body that is not JSON → 400. `GET
/api/tasks/sessions` from the Mac with no `Origin` → 403 (the strict check, unchanged). Anyone on the tailnet can
write progress and Work tab blocks, as anyone on the laptop could before; the tailnet is his own devices.

### Checked live on the Mac (2026-11-17; throwaway dev server on 3111, copied data, registry copy without the PC)

- The look: reachable, Darwin, Codex `0.169.0-alpha.11.1` at the ChatGPT.app path, daemon running (server 0.158.0),
  Claude 2.1.285 with the bridge running. Status through `ssh macbook <ChatGPT.app codex> app-server proxy` → the
  running daemon: Codex `ready` (Plus, version 0.158.0 from the daemon, its limits); models (gpt-6-astra default …);
  own settings `never` / `danger-full-access`; its native list for `~/projects/projects-index`. Claude Code `ready`
  (Max) through the bridge there (status only, no turn).
- One Codex turn, from the route the form uses, on a throwaway task that exists only in the copy
  (`c0de3111-…-ac01`), in `~/projects/projects-index`, mode Plan only (read-only sandbox), prompt "run pwd and say what
  it printed": thread `01a1eaf4-2779-7142-b465-7d6a25f4e30a`. The stream delivered it live (turn-started 1.4 s after
  the start, deltas, `pwd` → `/Users/adamyasingh/projects/projects-index`, completed in 30 s). Codex then tried to
  record progress with `curl -s -X POST https://ubuntu-laptop.taile85e97.ts.net/api/tasks/progress …` (the brief's new
  address): the sandbox blocked the network, it asked to run it outside, and the request was **denied** from the pane's
  route (production was never written to; that id is not a task there anyway). Its reply said so.
- Native there: the thread is in the Mac's `~/.codex/session_index.jsonl` ("run pwd and say what it printed"), its
  rollout is `~/.codex/sessions/2026/11/17/rollout-…-01a1eaf4-….jsonl` with source `vscode` / originator "Codex
  Desktop", and `thread/list` (the pane's "Continue an existing session") lists it. The rollout's first message holds
  "runs on his laptop; from here it is at https://ubuntu-laptop.taile85e97.ts.net" and no `127.0.0.1:3000`.
- The pane (headless Chrome, 1440 wide): the row reads "Mac · projects-index", the head "Mac · projects-index", and
  "Open in Codex" shows `ssh -t macbook 'exec "$SHELL" -lc "cd ~/projects/projects-index &&
  /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex resume 01a1eaf4-…"'`
  (that path and `resume --help` checked to run there in the login shell). One turn in all; nothing installed,
  started or stopped on the Mac (the turn attached to the running daemon; the ssh pipe ended with the dev server).
- Session index, `scripts/session-index.ts sync --host mac --budget 240` on a scratch data dir: the BSD `stat`
  listing works as written (843 files in 0.6 s: 377 Claude Code transcripts, 3.7 GB; 314 Codex rollouts, 310 of them
  `.zst`, 150 MB; `session_index.jsonl`; 151 Claude app records, 14 MB) and found the ChatGPT.app Codex for the rows.
  In 240 s it read 67 files (newest first, all Claude Code) into 42 sessions and 13 app records; 776 were left for later
  runs (peak 296 MB). Production's timer reads the rest over its next runs, as with the PC.

