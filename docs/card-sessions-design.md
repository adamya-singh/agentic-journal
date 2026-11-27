# Card sessions: design proposal

Status: proposal, 2026-10-28. Nothing is built yet. From the Bugs/Features request of Oct 20 (bf_0e990f40).

## Goal

Make every card the place where you jump in. A card should show each OpenClaw, Claude Code and Codex session that already worked on its task, say in one line what happened there, and let you continue in that session with one click. The same matches also feed the brief: whatever a session found or decided becomes part of the card.

"Card" covers both kinds:

- **Task brief cards** on Dawn (`TaskBrief`, `src/lib/task-brief.ts`), keyed by task id.
- **Far-side action cards** (`ActionCard`, `src/lib/action-cards/types.ts`), keyed by `ac_…` id.

Constraint: no searching with tools across all sessions for every card. Each card or session should cost a few cheap model calls, made once, plus fast local lookups.

## What's on disk (measured 2026-10-28)

| Source | Where | Volume | Conversation text |
|---|---|---|---|
| OpenClaw | `~/.openclaw/agents/main/agent/openclaw-agent.sqlite` (8.4 GB). Tables `session_windows` (key, `display_name`, times) and `session_transcript_fts` (FTS5, one row per message) | 54,311 windows. **53,522 are cron runs.** About 800 are real: `main` (one 19.8k-message thread), `dashboard:*`, `ios-*`, `telegram`, `journal-chat-*`, `journal-brief-*` | ~5.7M chars (user and assistant only, no cron) |
| Claude Code | `~/.claude/projects/<cwd>/<uuid>.jsonl` (1.1 GB, mostly tool output). `custom-title` records give the title | 106 sessions (+74 subagent files, skipped). The `-home-rpi5-*` folders come from the old machine | ~3.2M chars of user and assistant text |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `archived_sessions/*.jsonl.zst`. A `session_meta` record gives the cwd | ~390 rollouts, last used about June | small |

That's about 9M chars, roughly 2.3M tokens, to index once. After that it grows by a few hundred KB a day. OpenClaw's FTS table means we never have to parse its 8 GB file ourselves: a read-only SQL query gets the messages out.

Three things to know about the data:

- Cron runs are noise for this (the Feed Curator, job workers, heartbeats). They're left out of semantic matching. They only count when their key names the card (see Anchors).
- Long sessions cover many tasks. OpenClaw `main` and long Claude Code sessions have to be split, or one giant session would match everything weakly.
- The Journal already puts task ids in OpenClaw keys: `agent:main:journal-chat-<taskId>-<ts>` (`src/lib/task-chat.ts`) and `agent:main:journal-brief-<taskId>-<ts>` (`brief-agent/worker.ts`). Those links are already known for certain and cost nothing.

## Approach: index once, link incrementally, judge only the shortlist

```
  transcripts ──► episodes ──► summary + anchors + vector ──► session index (SQLite)
                                                                   │
   card created/changed ──► search all episodes ─┐                 │
   episode created/changed ──► search open cards ─┼──► shortlist ──► judge (cheap LLM) ──► links
                                                  │                                       │
                                     anchors (exact ids) ─────────────────────────────────┘
                                                                                          ▼
                                                     card "Sessions" section + brief context
```

### 1. Episodes: what gets indexed

An **episode** is a stretch of one session about one thing. It's the unit we index and link.

- Split a session where there's a gap of more than 90 minutes, or when an episode passes ~8k tokens. A short session is a single episode.
- Keep only user and assistant text: no tool results, no system or meta records, no subagent files. Tool *calls* are kept as one-line stubs (`Edit src/lib/horizon.ts`, `bash: node scripts/action-cards.ts upsert`), because file paths and commands are strong signals.
- Each episode stores: `source`, `sessionRef` (OpenClaw key / Claude uuid / Codex id), its range (first and last message id or line), `startedAt`/`endedAt`, `cwd` or channel, `title` (OpenClaw `display_name`, Claude `custom-title`, or the first user message), and a hash of its text.

### 2. Per episode, once: summary, anchors, vector

**Anchors** are pulled out with regex, which is free and certain:
- Journal ids: task uuids that exist in the task store, `ac_xxxxxxxx`, `bf_xxxxxxxx`, job listing ids, interview process ids.
- URLs (Canvas assignment URLs, job postings, X post ids), repo-relative file paths, and course codes.
- Session keys that contain a task id (`journal-chat-<id>`, `journal-brief-<id>`).

**Summary:** one call to Gemini Flash-Lite on Vertex, which the Journal already uses through `@ai-sdk/google-vertex`. It gets the episode text and returns JSON:
`{ gist: 1–2 sentences, did: [...], decided: [...], open: [...], entities: [course, company, project names], state: 'done' | 'in-progress' | 'stuck' | 'chat' }`.
The card shows this summary, and the brief agent reads it later, so the raw transcript is never needed again.

**Vector:** embed `title + gist + did + decided + entities` with `gemini-embedding-001` (768 dims, `RETRIEVAL_DOCUMENT`). That's one vector per episode. We embed the summary rather than raw chunks: it's cleaner, raw chunks are full of tool chatter, and it keeps the store at a few thousand vectors.

**Cost of the first backfill:** about 2.3M tokens into Flash-Lite plus about 0.3M into the embedder, so **under $1 once**. After that, a few cents a week.

Before anything leaves the machine, a secret scrubber removes API keys, bearer tokens, `sk-…`/`AIza…`/JWT-shaped strings and `.env` lines. The OpenClaw state is known to have had live secrets in it.

### 3. Matching cards to episodes

The **card's query** is built from what it already has: the title, `short`, `what`/`stakes`, `next`, the course or company, the links, and the task id, embedded with `RETRIEVAL_QUERY`. For a far-side card it also includes the source post and the evidence text.

The **candidates** for a card are the union of:
1. **Anchor hits**: any episode whose anchors include this task id, `ac_` id, a link URL or the listing id. These are certain links and skip the judge.
2. **Vector top 15** by cosine over every episode vector. This is brute force in JS: 5k × 768 floats takes about 2 ms, so there's no vector database.
3. **Keyword top 15** from an FTS5 table over the episode summaries plus entity names, so that exact names ("Roadrunner", "Moral Machine", "CS 439") aren't lost to fuzzy embeddings.

These are fused with reciprocal-rank fusion, giving a **shortlist of at most 8** that aren't anchored.

The **judge** is one Flash-Lite call per card, not one per pair. It gets the card and the 8 summaries and returns, for each, `{ related: yes|partly|no, why: one line, role: 'worked on it' | 'mentioned' | 'background' }`. Only `yes` and `partly` are stored. That's about 3k tokens per card, and it only runs when the shortlist has changed since the last judgement.

### 4. Keeping it fresh without re-searching

This is what keeps it cheap: **each direction runs only when its own side changes.**

- **A new or changed episode** (the indexer sees a new session, or one that grew) is embedded once and compared against the **open cards only** (tens of vectors). It goes to that card's judge only if it would enter the card's top 8 or carries an anchor.
- **A new or changed card** (its fingerprint changes when the text, due date, notes or links change) is searched against all episodes once.
- Judgements are cached by `(card fingerprint, sorted candidate episode hashes)`, so opening a card never calls a model.

The indexer is a small worker, like the acquisition and inbox workers. It runs every 10 minutes under `nice`, reads OpenClaw read-only, and tracks a cursor per source: `session_windows.updated_at` / `indexed_seq` for OpenClaw, byte offset + mtime per jsonl for Claude Code, and the file list for Codex. A pass that finds nothing new costs nothing. Machine memory is tight, so it streams files and keeps vectors as `Float32Array` (~15 MB).

### 5. Getting it right

"Perfect" mostly comes from not showing wrong links:
- Anchored links are always right. The Journal should **create more anchors**: put the task id or `ac_` id in every session it starts (it already does for chat and brief), have "Hand to OpenClaw" and the Bugs/Features handoff write the card id into the prompt, and add a "Start a Claude Code session" action that starts with the card id in its first message.
- The judge must cite: `why` has to name something specific from the episode, and a vague `why` is dropped.
- **Your corrections stick.** Each linked session has a quiet "Not this" control. The unlink is stored by `(card, episode)` and never suggested again, and it's also passed to the judge as a counter-example for that card. "Link a session…" lets you paste a session key or uuid when a session is missing.
- An eval set: hand-label 30 cards (a mix of class tasks, OAs and far-side cards) with their true sessions, then check precision and recall whenever thresholds or prompts change. This sits next to the existing `scripts/*.test.ts`.

## Storage

`BACKEND_DATA_DIR/session-index/index.sqlite`, through `node:sqlite` (Node 24, no new dependency):

- `episodes(id, source, session_ref, range, started_at, ended_at, cwd, title, hash, summary_json, state)`
- `episode_vectors(episode_id, model, dims, vec BLOB)`
- `episode_fts` (FTS5 over title + gist + entities)
- `episode_anchors(episode_id, kind, value)`, indexed on `(kind, value)`
- `cursors(source, key, value)`
- `card_links(card_kind 'task'|'action', card_id, episode_id, via 'anchor'|'judge'|'manual', related, role, why, judged_at, unlinked_at)`
- `card_judgements(card_kind, card_id, card_fingerprint, candidate_hash, at)`

Everything in it can be rebuilt from the transcripts except `card_links` rows with `via='manual'` or `unlinked_at`, which are your input. A small `card-links.json` sidecar keeps those so a rebuild never loses them.

## On the card

The **Sessions** section sits between Start here and Facts in the brief card, the full brief and the far-side `ActionCardView`, in the existing card style:

- One row per **session** (episodes from the same session are folded together): a source mark (OpenClaw, Claude Code, Codex), the title, when (relative), a `state` chip and the judge's one-line `why`. Anchored rows get a small "linked" tick.
- Click to open it. OpenClaw opens the Control UI deep link `/chat?session=<key>`. Claude Code and Codex copy `claude --resume <uuid>` / `codex resume <id>` with the cwd, plus a desktop deep link if one exists (open question).
- **Continue** puts the most recent `in-progress` session first. If there's none, the card's existing Ask OpenClaw stays the way in.
- When nothing is linked, the section is hidden, not shown empty.

**Brief context:** the brief agent (`brief-agent.ts`) and the task chat (`task-chat.ts`) get the linked episodes' `gist/decided/open` as an extra block, so OpenClaw's facts and steps include what sessions already found ("the Judge session was done on Oct 22, screenshot not uploaded yet"). This is where "aggregate all of our information" happens. It costs nothing extra, because the summaries already exist.

## Rollout

1. **Anchors only:** the indexer for OpenClaw + Claude Code, anchor extraction, and the Sessions section showing anchored links. No model calls. This already covers every Ask OpenClaw chat and brief fill.
2. **Summaries + vectors + judge**, with a backfill run on a copy of the data first (throwaway test instance), and the eval set.
3. **Feeding the brief:** linked summaries go into the brief agent and the task chat.
4. Codex, the "Not this" / "Link a session…" controls, and new sessions that carry anchors.

## Open questions

1. **Old-machine sessions** (`-home-rpi5-*`): index them for context even though they can't be resumed here? (Proposed: yes, marked "archive".)
2. **Cron runs:** keep them strictly anchor-only, or let the job-application worker runs link to their job's cards? (Proposed: anchor-only, with job listing ids as the anchor.)
3. **Desktop app deep link** for Claude Code sessions: if there's no URL scheme, the fallback is copying the resume command.
4. **Privacy:** summaries and embeddings go to Vertex (your GCP project, same as the capture and feed judge). The fully local alternative is an Ollama embedder (`nomic-embed-text`), but local summarization would be too slow and memory-hungry on this box.
