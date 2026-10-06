import { runWorker } from '../src/lib/bookmarks/sync.ts';
runWorker().catch(() => {
  console.error('Bookmark worker stopped. Check storage permissions and restart the service.');
  process.exitCode = 1;
});
