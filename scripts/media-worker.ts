import { runWorker } from '../src/lib/media/worker.ts';
runWorker().catch(() => {
  console.error('Media worker stopped. Check storage permissions and restart the service.');
  process.exitCode = 1;
});
