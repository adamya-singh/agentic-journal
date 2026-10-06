// Saves local copies of the videos/GIFs in a bookmark folder (or all bookmarks).
// Usage: npm run bookmarks:videos -- --folder <folderId> [--dry-run]
//        npm run bookmarks:videos -- --all [--dry-run]
// Posts imported before video links were requested are looked up first (paid, ~$0.005/post,
// within the local monthly allowance); the MP4 downloads themselves are free.
import { listBookmarks } from '../src/lib/bookmarks/store.ts';
import { refreshVideoLinks } from '../src/lib/bookmarks/sync.ts';
import { downloadVideos } from '../src/lib/bookmarks/media.ts';

const args = process.argv.slice(2);
const folder = args.includes('--folder') ? args[args.indexOf('--folder') + 1] : undefined;
const dryRun = args.includes('--dry-run');
if (!folder && !args.includes('--all')) {
  console.error('Pass --folder <folderId> or --all.');
  process.exit(1);
}
const posts = [];
for (let offset: number | null = 0; offset !== null; ) {
  const page = listBookmarks(
    new URLSearchParams({ ...(folder ? { folder } : {}), offset: String(offset), limit: '100' }),
  );
  posts.push(...page.items);
  offset = page.nextOffset;
}
const withVideo = posts.filter((p) => p.media.some((m) => m.type !== 'photo'));
const needLinks = withVideo.filter((p) => p.media.some((m) => m.type !== 'photo' && !m.video));
console.log(
  JSON.stringify({ posts: posts.length, withVideo: withVideo.length, needLinks: needLinks.length }),
);
if (dryRun) process.exit(0);
try {
  if (needLinks.length)
    console.log(JSON.stringify({ links: await refreshVideoLinks(needLinks.map((p) => p.id)) }));
  const result = await downloadVideos(
    withVideo.map((p) => p.id),
    fetch,
    (line) => console.log(line),
  );
  console.log(
    JSON.stringify({ ...result, megabytes: Math.round(result.bytes / 1048576), bytes: undefined }),
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
