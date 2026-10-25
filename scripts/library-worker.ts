import { runLibraryWorker } from '../src/lib/media/library-sync.ts';
runLibraryWorker().catch(() => {
  console.error('Library worker stopped. Check storage permissions and restart the service.');
  process.exitCode = 1;
});
