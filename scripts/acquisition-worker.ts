import { reconcileAcquisitions } from '../src/lib/media/acquisition-worker.ts';
import { withLock } from '../src/lib/media/store.ts';

await withLock(async () => {
  for (;;) {
    try {
      await reconcileAcquisitions();
    } catch {
      console.error('Media reconciliation failed; check stack configuration and local storage.');
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}, 'acquisition-worker');
