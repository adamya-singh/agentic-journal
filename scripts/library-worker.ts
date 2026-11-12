import { runLibraryWorker } from '../src/lib/media/library-sync.ts';
runLibraryWorker().catch((e) => {
  console.error(`Library worker stopped: ${(e as Error).message}`);
  process.exitCode = 1;
});
