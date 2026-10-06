import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  dataRoot,
  readState,
  readSources,
  writeJson,
  withLock,
  readJson,
  ensureSavedRanks,
  readFolders,
} from './store.ts';
import {
  credentials,
  configured,
  callbackUrl,
  fetchPage,
  fetchFolderPage,
  normalizePost,
  XError,
} from './x-client.ts';
import type { BookmarkStatus } from './types.ts';

export const MONTHLY_LIMIT = 5;
// Deliberately conservative: one post, one author, up to four media resources.
// These are estimates, not invoice amounts; X's console cap is authoritative.
const PAGE_UNIT_RESERVE = 0.051;
// Settled per-page cost, calibrated against the X console on 2026-10-06: 282 bookmarked posts
// with author and media expansions billed as 282 events ($0.29). Expansions were not billed.
const POST_COST = 0.001;
const EXPANSION_COST = 0;
// A folder page returns up to 100 resources; settled per returned folder or post ID.
const FOLDER_PAGE_RESERVE = 0.1;
const MAX_FOLDER_PAGES = 200;
export const billingMonth = () => new Date().toISOString().slice(0, 7);
export function status(): BookmarkStatus {
  const s = readState(),
    beat = readJson<{ at?: number }>('worker.json', {});
  return {
    ...s,
    job: s.job ? { ...s.job, knownIds: [], seenCursors: [] } : undefined,
    configured: configured(),
    connected: !!credentials().accessToken,
    total: Object.values(readSources()).filter((v) => v.accountId === s.accountId).length,
    estimate: s.usage[billingMonth()] || 0,
    monthlyLimit: MONTHLY_LIMIT,
    callbackUrl: callbackUrl(),
    workerAvailable: !!beat.at && Date.now() - beat.at < 90_000,
  };
}
export function heartbeat() {
  writeJson('worker.json', { at: Date.now() });
}
function recordHistory(s: ReturnType<typeof readState>) {
  if (!s.job) return;
  const { knownIds, seenCursors, ...summary } = s.job;
  void knownIds;
  void seenCursors;
  s.history = [summary, ...s.history.filter((j) => j.id !== summary.id)].slice(0, 20);
}
export async function settings(update: { budgetConfirmed?: boolean; pilotReviewed?: boolean }) {
  return withLock(() => {
    const s = readState();
    if (update.budgetConfirmed !== undefined) s.budgetConfirmed = update.budgetConfirmed;
    if (update.pilotReviewed !== undefined) {
      if (update.pilotReviewed && !s.pilotComplete)
        throw new Error('Run the five-post pilot first.');
      s.pilotReviewed = update.pilotReviewed;
    }
    writeJson('state.json', s);
  });
}
export async function startSync(resume = false) {
  return withLock(() => {
    const s = readState();
    if (s.job && ['queued', 'running'].includes(s.job.status)) return s.job.id;
    if (!s.accountId || !credentials().accessToken) throw new Error('Connect X before syncing.');
    if (!s.budgetConfirmed)
      throw new Error(
        'Confirm the $5 spending limit and disabled auto-recharge in connection settings.',
      );
    if (s.pilotComplete && !s.pilotReviewed)
      throw new Error('Review the pilot charge in X, then confirm it in connection settings.');
    if ((s.usage[billingMonth()] || 0) + PAGE_UNIT_RESERVE > MONTHLY_LIMIT)
      throw new Error(
        'The local monthly allowance is exhausted. X billing is available in the Developer Console.',
      );
    if (resume) {
      if (!s.job || !['paused', 'cancelled'].includes(s.job.status))
        throw new Error('There is no paused import to resume.');
      s.job.status = s.job.scanComplete ? 'completed' : 'queued';
      s.job.reason = s.job.scanComplete ? 'All available bookmarks imported.' : undefined;
      if (s.job.scanComplete) {
        s.lastSyncAt = new Date().toISOString();
        recordHistory(s);
      }
      s.job.cancelRequested = false;
      s.job.updatedAt = new Date().toISOString();
    } else {
      if (s.job?.status === 'paused') throw new Error('Resume or cancel the paused import first.');
      const now = new Date().toISOString();
      s.job = {
        id: randomUUID(),
        status: 'queued',
        phase: !s.historyComplete && !s.historyCursor ? 'history' : 'recent',
        knownIds: Object.keys(readSources()),
        pages: 0,
        imported: 0,
        startedAt: now,
        updatedAt: now,
      };
    }
    writeJson('state.json', s);
    return s.job!.id;
  });
}
export async function cancelSync() {
  return withLock(() => {
    const s = readState();
    if (s.job && ['queued', 'running', 'paused'].includes(s.job.status)) {
      s.job.cancelRequested = true;
      if (s.job.status !== 'running') s.job.status = 'cancelled';
      s.job.reason = 'Cancelled by you. Saved posts are retained.';
      s.job.updatedAt = new Date().toISOString();
      recordHistory(s);
      writeJson('state.json', s);
    }
  });
}
export async function recoverInterrupted() {
  await withLock(() => {
    const s = readState();
    if (s.job && ['queued', 'running'].includes(s.job.status)) {
      s.job.status = 'paused';
      s.job.reason = 'Worker restarted. Resume manually to continue.';
      recordHistory(s);
      writeJson('state.json', s);
    }
  });
}
export async function processJob(fetcher: typeof fetch = fetch) {
  const current = await withLock(() => {
    const s = readState();
    if (s.job?.status !== 'queued') return null;
    s.job.status = 'running';
    writeJson('state.json', s);
    return structuredClone(s.job);
  });
  if (!current) return;
  const id = current.id;
  while (true) {
    heartbeat();
    const reservation = await withLock(() => {
      const s = readState(),
        job = s.job;
      if (!job || job.id !== id || job.status !== 'running') return null;
      if (job.cancelRequested) {
        job.status = 'cancelled';
        recordHistory(s);
        writeJson('state.json', s);
        return null;
      }
      const month = billingMonth(),
        remaining = MONTHLY_LIMIT - (s.usage[month] || 0);
      const limit = Math.min(
        s.pilotComplete ? 25 : 5,
        Math.floor((remaining + 1e-8) / PAGE_UNIT_RESERVE),
      );
      if (limit < 1 || (s.pilotComplete && !s.pilotReviewed) || !s.budgetConfirmed) {
        job.status = 'paused';
        job.reason = !s.budgetConfirmed
          ? 'Confirm billing settings before continuing.'
          : s.pilotComplete && !s.pilotReviewed
            ? 'Pilot complete. Review its charge in X and confirm in settings before resuming.'
            : 'Monthly local allowance reached. Resume manually after reviewing billing.';
        recordHistory(s);
        writeJson('state.json', s);
        return null;
      }
      const reserved = limit * PAGE_UNIT_RESERVE;
      s.usage[month] = (s.usage[month] || 0) + reserved;
      writeJson('state.json', s);
      return { accountId: s.accountId!, job: structuredClone(job), limit, reserved, month };
    });
    if (!reservation) return;
    try {
      const page = await fetchPage(
        reservation.accountId,
        reservation.job.cursor,
        reservation.limit,
        fetcher,
      );
      if (
        page.next &&
        (page.next === reservation.job.cursor ||
          reservation.job.seenCursors?.includes(`${reservation.job.phase}:${page.next}`))
      )
        throw new XError(
          'invalid_request',
          'X repeated a pagination cursor. Resume to restart this scan safely.',
        );
      const proceed = await withLock(() => {
        const s = readState(),
          job = s.job;
        if (!job || job.id !== id) return false;
        const sources = readSources(),
          known = new Set(job.knownIds);
        ensureSavedRanks(sources);
        const ranks = Object.values(sources).map((v) => v.savedRank!);
        // History pages extend the oldest end; recent pages sit above everything already known.
        let bottom = ranks.length ? Math.min(...ranks) : 1;
        if (reservation.job.phase === 'recent' && job.rankTop === undefined) {
          job.rankTop = (ranks.length ? Math.max(...ranks) : 0) + 1_000_000;
          job.rankUsed = 0;
        }
        const allKnown =
          page.data.length > 0 &&
          page.data.every((p: { id: string }) => known.has(`${reservation.accountId}:${p.id}`));
        let added = 0;
        // Preserve source order within a batch; source records are written before the checkpoint.
        const importedBase = Date.now();
        page.data.forEach((post, index) => {
          const key = `${reservation.accountId}:${post.id}`,
            previous = sources[key];
          if (!previous) added++;
          sources[key] = {
            ...normalizePost(
              post,
              page.includes,
              reservation.accountId,
              previous?.importedAt || new Date(importedBase - index).toISOString(),
            ),
            savedRank:
              previous?.savedRank ??
              (reservation.job.phase === 'history' ? --bottom : job.rankTop! - job.rankUsed!++),
          };
        });
        writeJson('sources.json', sources);
        const estimate =
          page.data.length * POST_COST +
          ((page.includes.users?.length || 0) + (page.includes.media?.length || 0)) *
            EXPANSION_COST;
        s.usage[reservation.month] = Math.max(
          0,
          s.usage[reservation.month] - reservation.reserved + Math.max(estimate, 0),
        );
        job.seenCursors = [
          ...(job.seenCursors || []),
          `${reservation.job.phase}:${reservation.job.cursor || '<start>'}`,
        ];
        job.pages++;
        job.imported += added;
        job.updatedAt = new Date().toISOString();
        const wasPilot = !s.pilotComplete;
        s.pilotComplete = true;
        if (job.phase === 'history') {
          s.historyCursor = page.next;
          job.cursor = page.next;
          if (!page.next) s.historyComplete = true;
        } else if (allKnown && s.historyComplete) {
          job.cursor = undefined;
        } else if (allKnown && s.historyCursor) {
          job.phase = 'history';
          job.cursor = s.historyCursor;
        } else {
          job.cursor = page.next;
          if (!page.next) {
            s.historyComplete = true;
            s.historyCursor = undefined;
          }
        }
        const done = (job.phase === 'recent' && allKnown && s.historyComplete) || !job.cursor;
        job.scanComplete = done;
        if (job.cancelRequested) {
          job.status = 'cancelled';
          job.reason = 'Cancelled by you. Saved posts are retained.';
        } else if (wasPilot && !s.pilotReviewed) {
          job.status = 'paused';
          job.reason =
            'Pilot complete. Review its charge in X and confirm in settings before resuming.';
        } else if (done) {
          job.status = 'completed';
          job.reason = 'All available bookmarks imported.';
          s.lastSyncAt = job.updatedAt;
        }
        recordHistory(s);
        writeJson('state.json', s);
        return job.status === 'running';
      });
      if (!proceed) return;
    } catch (error) {
      await withLock(() => {
        const s = readState();
        if (s.job?.id !== id) return;
        s.job.status = s.job.cancelRequested ? 'cancelled' : 'paused';
        s.job.reason =
          error instanceof XError
            ? error.message
            : 'Import stopped safely. Check local storage and resume manually.';
        // Invalid cursors restart only after explicit resume, without losing the original known boundary.
        if (error instanceof XError && error.kind === 'invalid_request' && s.job.cursor) {
          s.job.cursor = undefined;
          s.job.phase = 'history';
          s.job.seenCursors = [];
          s.historyCursor = undefined;
          s.job.reason += ' The next manual resume restarts pagination.';
        }
        s.job.updatedAt = new Date().toISOString();
        recordHistory(s);
        writeJson('state.json', s);
      });
      return;
    }
  }
}
/**
 * Imports X bookmark folder names and which saved posts are in each, on explicit request.
 * Each page reserves budget before the request and settles to the returned resource count.
 * Membership is replaced only after every folder was read, so a failure leaves the old copy.
 */
export async function importFolders(fetcher: typeof fetch = fetch) {
  return withLock(async () => {
    const accountId = await withLock(() => {
      const s = readState();
      if (!s.accountId || !credentials().accessToken)
        throw new Error('Connect X before importing folders.');
      if (!s.budgetConfirmed)
        throw new Error(
          'Confirm the $5 spending limit and disabled auto-recharge in connection settings.',
        );
      return s.accountId;
    });
    const reserve = () =>
      withLock(() => {
        const s = readState(),
          month = billingMonth();
        if ((s.usage[month] || 0) + FOLDER_PAGE_RESERVE > MONTHLY_LIMIT)
          throw new Error('The local monthly allowance is exhausted. Folders were not updated.');
        s.usage[month] = (s.usage[month] || 0) + FOLDER_PAGE_RESERVE;
        writeJson('state.json', s);
        return month;
      });
    const settle = (month: string, count: number) =>
      withLock(() => {
        const s = readState();
        s.usage[month] = Math.max(
          0,
          (s.usage[month] || 0) - FOLDER_PAGE_RESERVE + count * POST_COST,
        );
        writeJson('state.json', s);
      });
    const readAll = async (folderId?: string) => {
      const out: { id: string; name?: string }[] = [],
        seen = new Set<string>();
      let cursor: string | undefined;
      for (let n = 0; n < MAX_FOLDER_PAGES; n++) {
        const month = await reserve();
        const page = await fetchFolderPage(accountId, folderId, cursor, fetcher);
        await settle(month, page.data.length);
        out.push(...page.data);
        if (!page.next) return out;
        if (seen.has(page.next))
          throw new XError(
            'invalid_request',
            'X repeated a folder pagination cursor. Folders were not updated.',
          );
        seen.add(page.next);
        cursor = page.next;
      }
      throw new XError('invalid_request', 'A bookmark folder is too large to import.');
    };
    const folders = (await readAll()).map((f) => ({ id: f.id, name: f.name! }));
    const membership: Record<string, string[]> = {};
    for (const folder of folders)
      for (const post of await readAll(folder.id)) {
        const list = (membership[post.id] ||= []);
        if (!list.includes(folder.id)) list.push(folder.id);
      }
    const syncedAt = new Date().toISOString();
    await withLock(() => {
      const previous = readFolders();
      // Website-read folder lists are complete where the API is capped at 20; keep them.
      const web = previous.accountId === accountId ? previous.web : undefined;
      writeJson('folders.json', {
        accountId,
        syncedAt,
        folders,
        membership,
        ...(web ? { web } : {}),
      });
    });
    return { folders: folders.length, assigned: Object.keys(membership).length, syncedAt };
  }, '.folders-lock');
}
export async function runWorker() {
  await withLock(async () => {
    await recoverInterrupted();
    const timer = setInterval(heartbeat, 20_000);
    try {
      while (true) {
        heartbeat();
        await processJob();
        await new Promise((r) => setTimeout(r, 2000));
      }
    } finally {
      clearInterval(timer);
      fs.rmSync(path.join(dataRoot(), 'worker.json'), { force: true });
    }
  }, '.worker-lock');
}
