// Explicit, opt-in live test. Generates media locally; downloads no entertainment content.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { stackConfig } from '../src/lib/media/stack-config.ts';
import { jellyCall, type JellyItem } from '../src/lib/media/stack-clients.ts';
import { requestAcquisition, withAcquisitions } from '../src/lib/media/acquisition-store.ts';
import { initialState, writeState } from '../src/lib/media/store.ts';
import {
  createPlayback,
  proxyPlayback,
  stopPlayback,
  type Playback,
} from '../src/lib/media/jellyfin-playback.ts';
const run = promisify(execFile);
const c = stackConfig();
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-playback-smoke-'));
process.env.BACKEND_DATA_DIR = data;
const name = `Journal verification ${randomBytes(4).toString('hex')}`;
const fixture = path.join(c.dataRoot, 'library', name),
  containerPath = `/data/library/${name}`;
let session: Playback | undefined;
let libraryAdded = false;
const server = http.createServer(async (req, res) => {
  try {
    const parts = req.url?.split('/') || [];
    const response = await proxyPlayback(
      parts[4],
      parts[5],
      new Request(`http://127.0.0.1${req.url}`, { headers: req.headers as Record<string, string> }),
      c,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  } catch {
    res.writeHead(502);
    res.end();
  }
});
try {
  fs.mkdirSync(fixture, { recursive: true });
  await run('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '12',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    path.join(fixture, 'Journal Direct.mp4'),
  ]);
  await run('ffmpeg', [
    '-v',
    'error',
    '-i',
    path.join(fixture, 'Journal Direct.mp4'),
    '-c:v',
    'copy',
    '-c:a',
    'ac3',
    path.join(fixture, 'Journal Incompatible.mkv'),
  ]);
  fs.writeFileSync(
    path.join(fixture, 'Journal Direct.en.srt'),
    '1\n00:00:00,000 --> 00:00:10,000\nJournal playback verification\n',
  );
  await jellyCall(
    c,
    `Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=movies&refreshLibrary=true`,
    {
      LibraryOptions: {
        PathInfos: [{ Path: containerPath }],
        EnableRealtimeMonitor: false,
        TypeOptions: [{ Type: 'Movie', MetadataFetchers: [], ImageFetchers: [] }],
      },
    },
    'POST',
    true,
  );
  libraryAdded = true;
  await jellyCall(c, 'Library/Refresh', {}, 'POST', true);
  let items: JellyItem[] = [];
  for (let i = 0; i < 30; i++) {
    items = (
      await jellyCall<{ Items: JellyItem[] }>(
        c,
        `Users/${c.jellyfin.userId}/Items?Recursive=true&IncludeItemTypes=Movie&Fields=Path`,
      )
    ).Items.filter((x) => x.Path?.startsWith(containerPath + '/'));
    if (items.length >= 2) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  assert.equal(items.length, 2, 'Jellyfin indexed both synthetic fixtures');
  const s = initialState();
  s.titles.tt1000001 = {
    id: 'tt1000001',
    title: name,
    url: '',
    type: 'Movie',
    collections: [],
    addedAt: new Date().toISOString(),
  };
  writeState(s);
  await requestAcquisition('tt1000001');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  for (const extension of ['.mp4', '.mkv']) {
    const item = items.find((i) => i.Path?.endsWith(extension))!;
    await withAcquisitions((store) => {
      store.requests.tt1000001.items = [{ key: 'film', itemId: item.Id, path: item.Path! }];
    });
    session = await createPlayback({ id: 'tt1000001', key: 'film', h264: true }, c);
    console.log(
      `${extension}: ${session.hls ? 'HLS remux/transcode' : 'direct play'}, ${session.audio.length} audio tracks, ${session.subtitles.length} subtitle tracks`,
    );
    const response = await fetch(origin + session.src, {
      headers: session.hls ? {} : { Range: 'bytes=0-1023' },
    });
    assert.equal(response.status, session.hls ? 200 : 206);
    const body = await response.arrayBuffer();
    assert.ok(body.byteLength > 0);
    if (!session.hls) {
      assert.equal(body.byteLength, 1024);
      assert.ok(session.subtitles.length, 'English subtitle exposed');
      const subs = await fetch(origin + session.subtitles[0].src);
      assert.equal(subs.status, 200);
      assert.match(await subs.text(), /WEBVTT/);
    }
    await run(
      'ffmpeg',
      ['-v', 'error', '-i', origin + session.src, '-ss', '4', '-t', '2', '-f', 'null', '-'],
      { timeout: 45000 },
    );
    await stopPlayback(session.token, c);
    session = undefined;
  }
  console.log(
    'Live direct play, byte-range seeking, English subtitles, HLS playback and decoding passed.',
  );
} finally {
  if (session) await stopPlayback(session.token, c).catch(() => {});
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (libraryAdded)
    await jellyCall(
      c,
      `Library/VirtualFolders?name=${encodeURIComponent(name)}&refreshLibrary=false`,
      undefined,
      'DELETE',
      true,
    ).catch(() => {});
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
}
