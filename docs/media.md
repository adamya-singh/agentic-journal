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

Official feature references: [IMDb Watched FAQ](https://help.imdb.com/article/imdb/new-features-updates/mark-as-watched-faq/GR2SD7Y4LZVNHUVH), [IMDb Watchlist FAQ](https://help.imdb.com/article/imdb/track-movies-tv/watchlist-faq/G9PA556494DM8YBA).
