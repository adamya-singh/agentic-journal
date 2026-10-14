# IMDb media page

Open `/media`. IMDb remains the source of title metadata, personal ratings, watch history, Watchlist membership, and personalized Top Picks. Journal keeps a private local cache so browsing does not depend on IMDb being online. It does not equate watching with liking: the Liked filter uses personal IMDb ratings of 7–10, never IMDb aggregate scores. Movies, series, episodes, and anime keep their canonical `tt…` identity.

Click **Connect IMDb** / **Refresh IMDb** to enqueue a manual refresh. The worker connects to the existing local OpenClaw `openclaw` browser profile; sign in there first. It discovers account-menu links, pins the collection author's account ID, checks account identity, loads all available history pages, and records per-collection coverage. Empty collections are recognized from IMDb's explicit empty-state message; missing count widgets alone are not evidence of zero. Partial imports preserve previously known membership. IMDb Top Picks are preferred; More Like This is a fallback with an explicit seed explanation. Already watched and dismissed titles are excluded from the recommendation view.

## Responses

- **I saw it** queues a watched addition on IMDb. This is a title-level IMDb flag, not a declaration that every episode of a series is complete.
- **Watchlist** queues an addition to the IMDb Watchlist. Seeing a title does not remove it from that list.
- **Rate** saves the exact selected integer score (1–10) on IMDb and records the title as watched, as IMDb does itself.
- **Interested** and **Not interested** are private Journal annotations. They reorder/hide picks without inventing ratings or modifying IMDb. Expand the dismissed section to restore a recommendation.

The worker checks the existing state before clicking and verifies the saved state after reload. The UI shows pending changes separately from confirmed saves. Duplicate actions reuse the pending job. Failed and interrupted writes require an explicit retry and start by rereading IMDb. No page visit, scheduled refresh, or idle worker loop fetches account data. Pending user-requested jobs survive page navigation; a running job interrupted by restart is marked failed rather than automatically replayed.

## Runtime

Requires Node 24, the `openclaw` CLI, and its running local Chromium profile. `playwright-core` attaches to that browser without starting a new profile or exporting authentication cookies. The worker creates and closes its own tab; existing user tabs stay open. No IMDb API credentials or IMDbPro subscription are needed. If IMDb asks for login/CAPTCHA, complete it in OpenClaw's browser and retry. Browser automation follows visible UI and can need repair after an IMDb redesign.

`IMDB_EXPECTED_NAME` defaults to `Adamya`; it is checked before the first import. The stable account ID is then pinned in local storage. Switching accounts requires an explicit migration of private media data, rather than mixing two libraries. `AGENTIC_JOURNAL_ORIGIN` optionally sets the permitted browser origin (default `https://ubuntu-laptop.taile85e97.ts.net`). Mutations reject foreign or absent Origin headers. The local CLI writes directly under filesystem permissions and requires no network token.

```bash
npm run media -- list
npm run media -- sync
npm run media -- seen tt1234567
npm run media -- watchlist tt1234567
npm run media -- rate tt1234567 8
npm run media -- dismiss tt1234567
npm run media -- restore tt1234567
npm run media:worker
```

CLI mutations take canonical IDs already in the cache. Unknown titles must first be resolved on IMDb; these commands never accept arbitrary navigation URLs. Inspect the returned job in `status` before reporting an external save as complete.

Storage: `src/backend/data/media/state.json`, redirected by `BACKEND_DATA_DIR` in tests, directory mode 0700 and files mode 0600. It holds source metadata, account identity, coverage, annotations, and jobs; no passwords or cookies. Private data is ignored by Git. Filesystem locks serialize API/CLI/worker updates and prevent simultaneous browser jobs; the cache stays readable during a sync. Deployments install `systemd/agentic-journal-media-worker.service` via the existing deploy script.

Validation: media tests exercise partial/empty coverage, source versus personal ratings, concurrent writes, feedback persistence/restore, duplicate clicks, failed saves, interrupted writes, CSRF rejection, and canonical ID extraction with isolated browser fixtures. Live account imports are read-only; rating/Watchlist write flows are not tested by inventing preferences on the real account.

## YouTube history

**Sync YouTube** (or the daily run) reads Adamya's YouTube watch history in OpenClaw's browser. The worker opens `youtube.com/feed/history` in its own tab and reads the page data plus later pages the way YouTube's own client requests them. It is read-only: it never likes, subscribes, removes or pauses anything. Shorts are listed without a channel, so their channel comes from YouTube's public oEmbed endpoint.

The first sync only reads which account is signed in and waits for **Yes, import my history** on /media. That account's `DATASYNC_ID` is then pinned; a later sync under another account fails without importing (OpenClaw's Chrome holds more than one Google account; switch back in the browser). A full import runs in jobs of at most 5 minutes; an unfinished one saves a cursor and queues the next job. Later syncs stop once a page is mostly known videos. The worker queues a sync a day after the last success, retrying a failed attempt at most hourly.

Videos wait in `media/youtube.json` as pending until kept or skipped: in bulk (watched under 20%, live streams, a whole channel, the one-offs), or one at a time in a channel's Pick grid. "Remember for new videos" makes a channel rule that decides that channel's future videos. A kept video becomes a `yt:<videoId>` title in `state.json` (`source: 'youtube'`), which is the only record of kept. It appears in the library (format **YouTube**) and can be ranked with everything else, but `yt:` titles are never written to IMDb: rating sync, IMDb jobs, recommendation seeds and IMDb refreshes all skip them. **Remove** on a video card unkeeps it and leaves it skipped.

```bash
npm run media -- youtube-sync
npm run media -- youtube-summary
```

Official feature references: [IMDb Watched FAQ](https://help.imdb.com/article/imdb/new-features-updates/mark-as-watched-faq/GR2SD7Y4LZVNHUVH), [IMDb Watchlist FAQ](https://help.imdb.com/article/imdb/track-movies-tv/watchlist-faq/G9PA556494DM8YBA).

## Your feed

`/media/feed` is an endless scroll of content judged to move you toward your compass: videos from your YouTube history, saved X bookmarks and unwatched IMDb picks, plus new uploads OpenClaw finds from channels you up-vote. Vote each item **Up** or **Down** (or skip it); the order changes as you vote.

- **Stream** is one column of cards with a side panel showing your compass, what your votes taught the feed and OpenClaw's last pass. **Theater** is one big player with an endless Up next list that auto-advances. Videos start muted (browsers require it); turn sound on once and later videos keep it. Keys: J/K next/previous, U up, D down, S skip, M sound, Space play/pause, O open, T switch view.
- **Compass**: Long-term is OpenClaw's North Star (`~/.openclaw/workspace/USER.md` "Core North Star" plus `MEMORY.md` "North Star Anchor" and `SOUL.md` "Canonical North Star"). Short-term is `$OPENCLAW_COMPASS_DIR/short-term/compass.md` (default `~/.openclaw/workspace/compass`, maintained by the compass skill; flat front matter `title`, `start`, `end`, and an H2 "Relation to the long-term compass"). The Journal only reads them. Every item is judged per compass, so Short-term turns on once items have been judged against it (`feed-judge --compass short`).
- **Ranking** (`src/lib/media/feed-rank.ts`): curator confidence for the selected compass, plus smoothed weights from your votes for the item's tags, creator and source, a small bonus for creators you have barely voted on and for fresh items, then a pass that never shows one creator twice in a row. A card shown on two different days without a vote is skipped. When fewer than 60 items wait, the best reserve candidates are promoted.
- **Seeding**: `npm run feed:seed -- judge` asks Gemini 2.5 Flash (Vertex, `FEED_JUDGE_MODEL` overrides) to judge every pool item against the long-term compass, checkpointing in `media/feed-seed-<compass>.json`; `report` shows the distribution; `write` puts the strongest ~400 in the queue (source quotas, per-creator cap) and keeps the rest of the aligned items as candidates. `FEED_LLM_DISABLED=1` turns the judge off.
- **OpenClaw** runs the `agentic-journal-feed-curator` skill each morning at 07:00 (cron "Agentic Journal Feed Curator", registered at server start; `FEED_CURATOR_CRON_DISABLED=1` skips registration, `OPENCLAW_FEED_CURATOR_CRON_ID` pins it). It reads `feed-digest`, adds new uploads from up-voted channels via YouTube RSS, judges new history and bookmarks, promotes candidates for your strongest tags and records the pass. It is read-only on YouTube, X and IMDb.

```bash
npm run media -- feed-digest
npm run media -- feed-candidates --source youtube --limit 50
npm run media -- feed-judge --compass short --scope items --limit 200
npm run media -- feed-add --file items.json --by openclaw
npm run media -- feed-promote --tag "frontier AI" --limit 10
npm run media -- feed-stats
```

Storage: `media/feed.json` (ids, per-compass judgments, your votes; titles, text and media are read from `youtube.json`, `state.json` and the bookmarks store at request time) under its own `feed` lock. The future plan, a real recommender still managed by OpenClaw, is a Bugs/Features entry.
