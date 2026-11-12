import { runWorker } from '../src/lib/bookmarks/sync.ts';
runWorker().catch((e) => {
  console.error(`Bookmark worker stopped: ${(e as Error).message}`);
  process.exitCode = 1;
});
