# Coding sessions in the task workspace (Codex, Claude Code)

Reference for Stages 1 and 2 of the plan "Claude Code and Codex sessions in the task workspace": what is built, the
contracts the chat pane (Stage 3) builds against, and what is still open. Stage 1 is the core and Codex on this
laptop; Stage 2 is Claude Code through its bridge (`bridge/`). With no bridge running, Claude Code reads `offline`
with a reason that says how to start it.

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
                        ▼                                        ▼
             Codex daemon (shared with the desktop app)    claude-bridge daemon (Agent SDK)
```

- **The Journal keeps only links.** `tasks/code-sessions.json` maps task id → links (`CodeSessionLink`: agent,
  host, cwd, the agent's own session id, title, picks, a glance: `lastState`, `lastLine`, `workingSince`,
  `settledAt`). The transcript stays with the agent and is read through the adapter (`history`).
- **Where a session runs** is a per-task place `{host, cwd}` in `tasks/task-places.json` (`places.ts`): the
  shared OpenClaw workspace (`workspaceRoot()`) or a project of the `proj` registry
  (`~/projects/projects-index`, override `PROJ_REGISTRY_DIR`; this host from `~/.config/proj/host`, override
  `PROJ_HOST`). A cwd must exist, be a folder, and be one of the offered roots or inside one (links resolved).
  Only this host's places can be started on; other hosts' projects are listed with `available: false`. A task whose
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
  `https://ubuntu-laptop.taile85e97.ts.net`), and any names in **`AGENTIC_JOURNAL_HOSTS`** (comma-separated, e.g.
  `box.tail1234.ts.net,journal.lan`; set it in the Journal's `.env`, there is no example env file in the repo).
  Without the name check a DNS-rebinding page (`http://evil.example:3000` pointed at this machine) passes over plain
  http: no `Sec-Fetch-Site` is sent and its Origin matches its Host by construction. The check stops other web
  pages in his browser; it does not stop a program on the machine, which can send any headers (and could reach the
  agents' sockets directly anyway). Reaching the Journal over plain http by another name (a tailnet IP) is refused.
- **Deploy queue.** `src/lib/deploy-queue.ts` `codeTurns()` reads `code-sessions.json` (it runs as a separate
  script and cannot see the hub). A link with `workingSince` less than 3 h old holds a deploy ("Codex session X
  is working"); one whose `settledAt` is within the 15-minute quiet period holds it as "was active N min ago".
  The hub sets `workingSince` while a turn runs or waits on approval and clears it when the turn ends.

Files: `src/lib/code-agents/{protocol,transport,adapter,codex-types,codex,claude,hub,store,places,first-turn}.ts`,
`src/app/api/tasks/sessions/route.ts`, `src/app/api/tasks/sessions/stream/route.ts`. Tests:
`scripts/code-agents-{transport,model,hub,routes,own,login}.test.ts` with the fake app server
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
  | plan | on-request | read-only | plan |
  | full | never | danger-full-access | bypassPermissions |

  Codex has a real "plan" collaboration mode only in its experimental API (not enabled); `plan` here is a
  read-only sandbox. An explicit mode goes on `thread/start` as `approvalPolicy` + `sandbox`, and on a later
  `turn/start` (only when it changed) as `approvalPolicy` + `sandboxPolicy`. Checked live: both override
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
  `notice {level: info|warning|error, text}` (compaction, review mode, retries, kinds Codex adds later).
  `ItemStatus = running | done | failed | declined`.
- `SessionTurn { id, status: running|done|interrupted|failed, items, error, limited?, startedAt, endedAt, diff? }`.
  `limited` = failed on the usage or rate limit.
- `ApprovalRequest { id, turnId, itemId, kind: command|file-change|tool|other, title, command?, detail?, cwd?, files?,
  decisions: ApprovalDecision[], elsewhere?, at }`, `ApprovalDecision = allow | allow-session | deny | cancel`.
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
- `CodeSessionLink` (stored) and `SessionSummary = link + {state, unread, approvals}` (listed).

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
               { "host": "mac", "cwd": "~/projects/site", "label": "site", "kind": "project", "project": "site", "available": false, "reason": "Sessions on mac are not available yet." }],
    "agents": { "codex": { "state": "ready", "account": { "kind": "subscription", "plan": "plus" }, "limits": { "windows": [{ "label": "5 hours", "usedPercent": 100, "resetsAt": 1794856885000 }], "blocked": true }, "version": "0.169.0" },
                "claude-code": { "state": "offline", "reason": "The Claude Code bridge isn’t running on this device. Start it with …" } } }
  ```
  (`agents` is shown here for reference: it now comes from its own request, below.) The list answers at once,
  without waiting on any agent. Sessions the store calls working but this process has not heard from are joined
  behind the answer (the next poll has their real state). Poll this like the chats list.
- `?id=<taskId>&agents` → `{ agents }`, each agent's status; each waits at most 4 s. The pane reads it beside the
  list, at most every 15 s, so opening a workspace never waits on a slow agent.
- `?id=<taskId>&session=<linkId>[&cursor=<older>]` → `{ link, turns, older, seq, state, turnId, approvals, tokens,
  models }`. `turns` is one page (20 turns), oldest first; `older` is the cursor for the page before (null at
  the start). Reading joins the session so its events start flowing. Follow with the stream from `seq`.
- `?id=<taskId>&native=codex&cwd=<folder>[&host=]` → `{ sessions: NativeSession[] }`, the agent's own sessions in
  that folder (the folder must be a valid place), each with `linkedTo` when already attached to a task.
- `?id=<taskId>&own=<agent>&cwd=<folder>[&host=]` → `{ own: OwnSettings }` for sessions in that folder (a valid
  place). The session detail carries `own` for the session's folder too (null when the agent did not say).
- `?id=<taskId>&login=<agent>[&host=]` → `{ login: AgentLogin | null }`: the sign-in running on that device, or one
  that ended in the last 5 minutes. Polled every 1.5 s by the pane while one runs. Another host is a 400 for now.

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
{ "action": "adopt", "taskId", "agent", "sessionId", "host"?, "picks"? } // attach a native session → the link; 409 if on another task;
                                                                         // 400 for another host, before the agent is asked anything
{ "action": "rename", "taskId", "session", "title" }                     // renamed in the agent too → the link
{ "action": "archive", "taskId", "session" }                             // archived in the agent, hidden from the list; 409 while running
{ "action": "picks", "taskId", "session", "picks" }                      // stored; applied on the next turn → the link
{ "action": "seen", "taskId", "session" }                                // → the link (unread clears)
{ "action": "place", "taskId", "place": { "host", "cwd" } }             // → the validated place
{ "action": "login", "taskId", "agent", "host"? }                       // start signing in → AgentLogin; 409 when signed in
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
  send(sessionId, text, picks): Promise<{ turnId }>;
  steer(sessionId, turnId, text); interrupt(sessionId, turnId);
  answer(approvalId, decision); rename(sessionId, title); archive(sessionId);
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
  `model` / `effort` when picked; `includePartialMessages: true`; `canUseTool`; `disallowedTools:
  ['AskUserQuestion']` (its question form has nowhere to show; Claude asks in its reply); `env` (below).
- **Environment:** the bridge's own minus every `CLAUDE_*`, `CLAUDECODE` and `ANTHROPIC_*`, plus
  `CLAUDE_CODE_ENTRYPOINT=agentic-journal`. No API key or base URL can reach Claude Code, so it uses this
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
  as `allowedTools` (`Tool(rule)`) and `additionalDirectories` (`sessionRuleOptions` in mapping.ts). A bridge
  restart forgets them, as Claude Code itself would. Tested only against the stand-in SDK. Limitation: the bridge cannot know a Claude app has
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
  api-key auth method reads `account.kind: 'api-key'`. Limits come from `rate_limit_event` messages.
- **Models:** `supportedModels()` on a short query with `persistSession: false` that runs no turn (works signed
  out), cached 10 min. The `default` row is dropped; the model it resolves to is marked `isDefault`.

### Bridge protocol v2

v2 (2026-11-17) adds the `own` mode, `settings/own` and the `login/*` requests; the adapter refuses a bridge that
answers another protocol ("Restart the bridge after a deploy"), so an old bridge never reads `own` as something else.

JSON-RPC without `"jsonrpc"`, one JSON message per WebSocket text frame, on the unix socket.

| client → bridge request | params | result |
|---|---|---|
| `initialize` | `{ clientInfo: {name, title, version} }` | `{ version, protocol: 2, claudeVersion, pid }` |
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

Answers: `allow` → `{behavior:'allow', updatedInput}`; `allow-session` → also `updatedPermissions` = Claude
Code's `suggestions` with `destination: 'session'` (never written to a settings file; offered only when there
are suggestions and no `suppressAlwaysAllowRule`); `deny` → `{behavior:'deny', message}`; `cancel` → deny with
`interrupt: true` (the turn ends `interrupted`).

### Items from SDK messages

Ids: text and thinking blocks `<API message id>:<block index>` (the SDK sends one assistant message per block,
sharing the API message id; stream events carry the same index), a tool call its `tool_use` id, his message its
uuid. Stream `text_delta` / `thinking_delta` → `item-delta` (`input_json_delta` is ignored; the whole tool call
comes in the assistant message). `text` → agent; `thinking` → reasoning (empty signed thinking, as the transcript
keeps it, is not shown); `Bash` → command (output from the tool's own `stdout`/`stderr` live, the result text in
history; exit code 0 on success, from `Exit code N` on failure); `Edit`/`Write`/`MultiEdit`/`NotebookEdit` →
file-change with a unified diff from the input (or the tool's `structuredPatch` live; `Write` is `add` unless
it says `update`); `TodoWrite` → plan; `WebSearch`/`WebFetch` → web-search; others (`mcp__server__tool` shown
`server.tool`, `Task`/`Agent`, `Read`, `Grep`, `Skill` …) → tool with a short input and the result clipped.
Results marked with the bridge's deny text or "doesn't want to proceed" → `declined`. Messages with a
`parent_tool_use_id` (inside a sub-agent) are not turns: live, each sub-agent tool call shows as "Working: …"
on the parent tool item; history leaves them out. History: a turn starts at each message he sent; "[Request
interrupted by user…]" marks the turn `interrupted`; a `<task-notification>` (or a non-human `origin`) starts a
turn with the notice "A background task reported back."; Claude Code's own `<synthetic>` messages are the
turn's error when worded as one ("API Error…", "Failed to authenticate…", usage limit), and are hidden
otherwise ("No response requested."). The running turn in a history answer is the bridge's live copy.

## Stage 0: Codex findings (used here)

- A Codex app-server daemon always runs here (`codex app-server --remote-control … --managed-daemon`), control
  socket `~/.codex/app-server-control/app-server-control.sock`, speaking **WebSocket** (one JSON message per text
  frame; JSON-RPC 2.0 without `"jsonrpc"`). `codex app-server proxy` only pipes bytes to it, so a client speaks
  WebSocket through it. The `ws` package connects directly: `ws+unix://<socket>:/`. `ws` is now a dependency and
  is kept out of the server bundle (`serverExternalPackages` in `next.config.ts`).
- Sequence: `initialize {clientInfo:{name:'agentic_journal',…}, capabilities:{experimentalApi:false}}` →
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
  adapter copies their paths onto the approval so a page read anew can name them.) Shown as "answer in the Codex app" and only declinable here:
  `item/permissions/requestApproval` (declined as `{permissions:{}, scope:'turn'}`), `item/tool/requestUserInput`
  (`{answers:{}}`), `mcpServer/elicitation/request` (`{action:'decline'|'cancel'}`), and the old
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

## Signing in (added 2026-11-17)

Where a new chat starts (NewChat.tsx), each agent's card says who is signed in on the device ("Signed in on laptop ·
Plus plan", `accountLine`), and an agent that is signed out gets a panel under the cards (`SignIn.tsx`) with **Sign
in** (and the terminal command as the other way). Laptop only for now: the route takes an optional `host` and
refuses any other with a 400, and the hub keeps one sign-in per (host, agent) connection, so Stage 4 can add hosts.

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
  `updatedPermissions`) or deny (`message`, `interrupt?`). From the SDK's types; never called for real here.
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

- Codex, checked live (see above): deltas, approvals, steer, interrupt, diffs, usage, per-turn sandbox. Still not
  seen: `turn/plan/updated` (needs the experimental API or another model), `item/permissions/requestApproval`,
  `item/tool/requestUserInput`, MCP elicitations.
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
- Codex `plan` mode is approximated by a read-only sandbox until the experimental collaboration mode is used.
- SSE through Tailscale serve and `next start` has not been tried on a running server (the strict check accepts
  Tailscale serve's shape, X-Forwarded-Host or Sec-Fetch-Site; unit-tested); nor has the `serverExternalPackages:
  ['ws']` production build (skipped in the live check: the laptop was short of memory).
- **Claude Code needs a signed-in turn** (the laptop's login had expired): a successful reply, real
  `stream_event` shapes and their order (thinking deltas, tool_use starts), a real `canUseTool` call and its
  `suggestions`, "allow for this session" taking effect, `interrupt()` mid-tool and the result it sends,
  `turn/steer` folding (one `result` or two), `rate_limit_event` values (is `utilization` a fraction, is
  `resetsAt` seconds), `claude auth status` fields when signed in (`subscriptionType`?), `accountInfo` with a
  subscription, and the Claude desktop app's session list. All are covered only against the stand-in SDK.
- `own` for Claude Code with a settings `defaultMode` of `bypassPermissions`: the SDK wants
  `allowDangerouslySkipPermissions` for that mode when it is given as an option; whether Claude Code honours it from
  settings without the flag (through the SDK) is not checked. Not the case here (no `defaultMode` set).
- Signing in: a Journal restart forgets a sign-in it was showing (memory only); the bridge stops its `claude auth
  login` when the Journal's connection goes, and Codex keeps its own until it expires. A successful Claude Code
  sign-in and a real Codex device-code sign-in have not been run.
- Claude bridge: not installed as a service yet; `bridge/` needs `npm install --omit=optional` on each device. A
  bridge restart ends running turns as failed (history shows the partial turn as done). A session open in a
  Claude app at the same moment is not detected (see "Changed elsewhere").
- Stage 3: session-index registration, sky/glance text naming the agent, the chat pane itself.
- Stage 4: `ssh <host> codex app-server proxy` as a `webSocketTransport({ createConnection })` byte pipe.

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
in one row on a phone), `SessionItems.tsx` (items as blocks: steps grouped, diffs, plan), `styles.ts`.

An agent's markdown never loads an image: an image shows as a link with its alt text (a reply could otherwise send
what it read to any server through an image's address, past Codex's own network block). A link opens in a new tab
(`noopener noreferrer`) unless it is a path on this site; `//host` and `/\host` count as other sites
(`isInternalHref`, also used by the OpenClaw chat pane).

Server additions for it: `CodeSessionLink.asking` (`{kind, title}` of the approval waiting, kept by the hub's
`settle` so the list and the sky can say "Codex needs you: Run npm test" without the hub); `GET ?id=&models=<agent>`
(models before a session starts); a link whose last turn failed reads `failed` after a restart until the next turn.
The sky (`sunrise/load.ts`) counts sessions from the links store (`skyChats`, `skyTalk`); a bubble for a session
carries the thread id `code:<linkId>`, which opens the workspace on that session.
