import { runWorker } from '../src/lib/media/worker.ts';
runWorker().catch((e) => {
  console.error(`Media worker stopped: ${(e as Error).message}`);
  process.exitCode = 1;
});
