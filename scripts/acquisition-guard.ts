import { guardDownloads } from '../src/lib/media/acquisition-worker.ts';
import { withLock } from '../src/lib/media/store.ts';
import { reapPlayback } from '../src/lib/media/jellyfin-playback.ts';

await withLock(async () => {
  do {
    try {
      await guardDownloads(undefined, process.argv.includes('--stop'));
    } catch {
      console.error('Media storage guard could not reach the downloader; no downloads admitted.');
    }
    if (!process.argv.includes('--stop')) {
      try {
        await reapPlayback();
      } catch {
        console.error('Playback cleanup will retry.');
      }
    }
    if (process.argv.includes('--stop')) break;
    await new Promise((r) => setTimeout(r, 10_000));
  } while (true);
}, 'acquisition-guard');
