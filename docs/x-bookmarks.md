# X bookmark collection

Open `/bookmarks` in Agentic Journal. Search, reading, tags, favorites and read status work against local data. No scheduled job or page visit fetches X content.

## Connect

1. Create a confidential Web App in the X Developer Console owned by the account whose bookmarks you want to import. Enable OAuth 2.0. Set read access and the callback shown in Bookmarks settings (normally `https://ubuntu-laptop.taile85e97.ts.net/api/bookmarks/oauth/callback`).
2. Before connecting, set the X console spending limit to **$5 per billing cycle**, and turn off auto-recharge. X is the authoritative billing system; the local estimate cannot enforce charges incurred by other applications or verify console settings.
3. Add `X_CLIENT_ID` and `X_CLIENT_SECRET` to the existing root `.env`. Optional `X_BOOKMARKS_ORIGIN` overrides the HTTPS Journal origin. Never use `NEXT_PUBLIC_` for credentials. Restart Journal and the bookmark worker after changing the environment.
4. Open Bookmarks settings, connect X, and confirm the console budget configuration. Connection requests account identity but does not start a bookmark import. Scopes are `bookmark.read tweet.read users.read offline.access`.
5. Click **Sync now**. The first import reads at most five posts, then pauses. Check the actual charge including author/media expansions in the X console, confirm the pilot review in settings, and press **Resume** to import the remaining available history.

Connecting makes one billed `GET /2/users/me` account lookup (an X "User: Read"), so the X account needs a positive API credit balance before Connect X can succeed.

### Connection failures

A failed callback records a sanitized diagnostic in `state.json` (`lastConnectionError`), shows it in Bookmarks settings, and logs one line to the Journal service journal:

```
[bookmarks] X connection failed stage=account_lookup status=402 reason=CreditsDepleted
```

Stages: `authorize` (denied on X), `state` (expired/mismatched request; reason says which), `busy`, `token_exchange` (code exchange: check Client ID/Secret and exact callback URL), `account_lookup` (`/2/users/me`: 402 means add credits, 401/403 means check app permissions/scopes), `account_mismatch`, `storage`. Only the stage, HTTP status and a short X error code are kept; when X sends a specific `reason` alongside a generic title it is appended, e.g. `reason=Client Forbidden - client-not-enrolled` (app not attached to a Project with v2 access). Codes, state, cookies, tokens and raw X bodies are never logged or stored. Tokens from a failed connection are discarded; fix the cause and click Connect X again.

There are no X write scopes. Reconnect uses the same account; switching accounts is intentionally blocked to avoid mixing private collections.

## Folders and sorting

X bookmark folders are imported only when you press **Import folders** (sidebar or settings) or run `npm run bookmarks -- folders`. It reads the folder list and each folder's post IDs (`GET /2/users/:id/bookmarks/folders` and `/folders/:folder_id`), stored in `folders.json`. Post bodies come from the regular import, so sync bookmarks first. Each request reserves $0.10 against the local allowance and settles to $0.001 per returned folder or post ID; X deduplicates resources requested within the same UTC day. X's folder endpoint returns only the 20 most recently added posts per folder, with no pagination (a known X API bug: https://devcommunity.x.com/t/bookmark-folder-endpoint-returns-only-20-ids-and-rejects-pagination-parameters/267427), so older folder posts show under "Other bookmarks". Membership is replaced only after every folder is read, so a failed import keeps the previous folders. Nothing is written to X.

"Recently saved" follows X's bookmark order (`savedRank`; X does not expose the time a post was bookmarked). Imports made before ranks existed are ordered from their per-page import timestamps. Other sorts: oldest saved, post date (newest/oldest) and author. Filters (folder, author, tag, type, unread, favorites, search) are kept in the page URL. Opening a post marks it read.

## Saved videos

`npm run bookmarks:videos -- --folder <folderId>` (or `--all`; add `--dry-run` to only count) keeps local copies of videos and GIFs. Syncs request X's media `variants`, and each media item stores the highest-bitrate MP4 from `video.twimg.com` as `video`. Posts imported before that are looked up once with `GET /2/tweets` (up to 100 IDs per request; reserved and settled at $0.005 per returned post against the local allowance). The MP4 downloads are free and sequential, written to `media/<postId>-<index>.mp4` via a temp file, capped at 1 GB each, and indexed in `media.json`. `/api/bookmarks/media/<postId>/<index>` streams them with Range support, and the reader plays saved videos inline instead of linking to X. Stills can be extracted later with ffmpeg if needed.

`npm run bookmarks:transcripts -- --folder <folderId>` (or `--all`; `--dry-run` shows minutes and estimated cost; `--force` redoes existing ones) transcribes saved videos with Google Speech-to-Text, reusing the Omi settings (`OMI_STT_LOCATION`, `OMI_STT_MODEL` = chirp_3, `OMI_STT_GCS_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS`). Audio is extracted with ffmpeg to 16 kHz mono FLAC, staged in the bucket, recognized with automatic language detection (one file per BatchRecognize request, four in parallel, since inline results allow a single file) and deleted from GCS. Google bills about $0.016 per audio minute. Results are stored in `transcripts.json` (`''` for no speech; videos with no audio track are recorded without a request), shown under each saved video in the reader and included in search.

## Worker and commands

Requires Node 24 (installed on this host; native TypeScript stripping is used).

```bash
npm run bookmarks:worker
npm run bookmarks -- status
npm run bookmarks -- sync
npm run bookmarks -- resume
npm run bookmarks -- cancel
npm run bookmarks -- folders
npm run bookmarks -- list --folder <id|none> --sort saved|saved-oldest|posted|posted-oldest|author
npm run bookmarks -- search --q "research"
npm run bookmarks -- get --key 123:456
npm run bookmarks -- update --key 123:456 --favorite true --tags research,reading
```

Run from the repository root. CLI output is JSON. `AGENTIC_JOURNAL_URL` defaults to `http://127.0.0.1:3000`; the CLI authenticates mutations with an owner-readable local token stored alongside OAuth credentials. To clear all tags, pass `--tags ','`.

Production deployment installs/enables `agentic-journal-bookmarks-worker.service`. It processes only explicit queued requests. A service restart pauses any queued/running import; manually resume it. The worker may continue across page navigation, but never resumes a paused run by itself.

```bash
sudo systemctl status agentic-journal-bookmarks-worker
sudo journalctl -u agentic-journal-bookmarks-worker -n 50
```

## Costs, recovery and storage

Local usage is a conservative calendar-month estimate in UTC, distinct from X's billing cycle. Each page reserves up to $0.051 per requested post (one post, one author, four media items), and successful pages replace the reservation with an estimate from returned resources. Successful pages settle at $0.001 per returned post with author/media expansions unbilled, matching the X console on 2026-10-06 (282 posts with expansions billed as 282 events, $0.29). Failed/ambiguous requests retain their reservation. Deduplication discounts are not assumed. The first run uses five posts; subsequent pages use at most 25. Console rates can change: check https://docs.x.com/x-api/getting-started/pricing before relying on estimates.

Import pauses at the local $5 allowance, rate limits, exhausted credits, invalid responses, revoked credentials or storage errors. No automatic network retries. Review the reason in the page, fix the problem, and manually resume. Invalid pagination cursors restart scanning safely on explicit resume. A new month alone never resumes a job. Checkpoints preserve completed pages; source writes occur before checkpoint advancement so a crash can replay a page without duplication.

Data resides under `src/backend/data/bookmarks` (or `BACKEND_DATA_DIR/bookmarks` in tests):

- `sources.json`: normalized post content, authors, media/link URLs, source and import times.
- `annotations.json`: local tags, favorite and read state.
- `state.json`: account identity, checkpoints, jobs, pilot controls and cost estimates.
- `credentials.json`: OAuth credentials and local CLI token, mode 0600; never returned by APIs.
- `worker.json`: local worker heartbeat.
- `folders.json`: folder names, API folder membership and full lists read from x.com (`web`).
- `media.json` and `media/`: downloaded videos.
- `transcripts.json`: video speech transcripts.

Back up the collection privately. Do not commit credentials or data. Removing a bookmark on X does not delete it here. Images remain remote URLs and can expire; the original X link stays available. Threads, article extraction, permanent media downloads and automatic AI enrichment are outside v1.

Verification: `node --test --import ./scripts/test-register.mjs scripts/bookmarks.test.ts`, `npm test`, and `npm run build:all`. Tests use temporary directories and mocked X responses; no paid X requests are made.

## Deployment verification

The production build and all 131 repository tests passed on 2026-10-05. Local and Tailscale page/API endpoints, CLI reads, all 21 page assets, cross-origin mutation rejection, and the Journal/bookmark worker services were checked. The shared host needed an additional temporary 4 GB swap file for the Next build; it was removed afterward. Build memory is bounded in the deployment script, and low-memory build failures require freeing memory or temporary swap before retrying. The previous deployment build is preserved at `/var/tmp/agentic-journal-previous-build-20261005`.

No X credentials were configured, so live OAuth/import and pilot billing verification remain pending. Browser automation was unavailable; mobile/desktop visual and keyboard checks still require an interactive browser.
