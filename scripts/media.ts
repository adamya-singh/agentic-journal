import { view, enqueue, feedback } from '../src/lib/media/store.ts';
const [command, ...args] = process.argv.slice(2);
try {
  let data: unknown;
  if (command === 'status' || command === 'list') data = view();
  else if (command === 'sync') data = { jobId: await enqueue('sync') };
  else if (command === 'seen' || command === 'watchlist')
    data = { jobId: await enqueue(command, args[0]) };
  else if (command === 'rate') {
    const rating = Number(args[1]);
    if (!Number.isInteger(rating) || rating < 1 || rating > 10)
      throw new Error('Supply an integer IMDb score from 1 to 10.');
    data = { jobId: await enqueue('rating', args[0], rating) };
  } else if (command === 'dismiss' || command === 'interested' || command === 'restore') {
    await feedback(
      args[0],
      command === 'restore' ? null : command === 'dismiss' ? 'dismissed' : 'interested',
    );
    data = view();
  } else
    throw new Error(
      'Usage: media.ts list|status|sync|seen ttID|watchlist ttID|rate ttID 1-10|dismiss ttID|interested ttID|restore ttID',
    );
  console.log(JSON.stringify({ success: true, data }));
} catch (e) {
  console.log(
    JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : 'Media command failed.',
    }),
  );
  process.exitCode = 1;
}
