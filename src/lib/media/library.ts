import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mediaRoot, withLock } from './store.ts';
import { episodeKey } from './catalog.ts';

// Your local library: video files you put in a folder, matched to the shows
// and films in Unwind and made playable in the browser. Anything that can put
// a file in the folder can feed it; the Journal itself never downloads media.
//
//   <library>/inbox/   drop anything here; names like Show.Name.S02E05.mkv or Film Name (2023).mp4
//   <library>/shows/   and films/: the same, if you sort by hand
//   <library>/.ready/  browser-playable copies and subtitles the worker makes
//
// The index is media/library.json with its own lock, so the worker's long
// ffmpeg runs never hold up votes or saving your place.

const run = promisify(execFile);
export const libraryRoot = () => process.env.MEDIA_LIBRARY_DIR || path.join(mediaRoot(), 'library');
export const LIBRARY_DIRS = ['inbox', 'shows', 'films'];
const READY = '.ready';
const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|ts|m2ts)$/i;
const SUBS = /\.(srt|vtt|ass|ssa)$/i;
// Files still being written (a download or a copy in progress) are left alone until they stop changing.
const PARTIAL = /\.(part|crdownload|!qb|tmp|download)$/i;
const SETTLE_MS = 2 * 60_000;

export type PrepPlan = 'direct' | 'remux' | 'audio' | 'transcode';
export interface Probe {
  durationSec?: number;
  container: string;
  video?: { codec: string; width?: number; height?: number; pixFmt?: string };
  audio: { index: number; codec: string; channels?: number; lang?: string; isDefault: boolean }[];
  subs: { index: number; codec: string; lang?: string }[];
}
export interface Guess {
  title: string;
  season?: number;
  number?: number;
  year?: string;
}
export interface LibFile {
  id: string;
  rel: string; // under the library root
  size: number;
  mtimeMs: number;
  seenAt: string;
  status: 'settling' | 'new' | 'preparing' | 'ready' | 'failed';
  guess?: Guess;
  match?: { showId: string; key: string; by: string; at: string };
  probe?: Probe;
  plan?: PrepPlan;
  playPath?: string; // under the root: the original (direct) or a .ready copy
  subtitles: { lang: string; file: string }[];
  error?: string;
  readyAt?: string;
  // When the catalogs were last asked about an unmatched name (once a day at most).
  lookedUpAt?: string;
}
export interface Library {
  version: 1;
  files: Record<string, LibFile>;
  scannedAt?: string;
}

const indexFile = () => path.join(mediaRoot(), 'library.json');
export function readLibrary(): Library {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, files: {} };
    throw new Error('Library index could not be read. Restore it before continuing.');
  }
}
function writeLibrary(l: Library) {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const tmp = `${indexFile()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(l) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, indexFile());
}
export const withLibrary = <T>(fn: (l: Library) => T | Promise<T>) =>
  withLock(async () => {
    const l = readLibrary();
    const out = await fn(l);
    writeLibrary(l);
    return out;
  }, 'library');

export const fileIdOf = (rel: string) => createHash('sha1').update(rel).digest('hex').slice(0, 16);
export function libraryFile(l: Library, id: string) {
  const f = l.files[id];
  return f ? { ...f, playable: f.status === 'ready' && !!f.playPath } : undefined;
}
// The only way a request turns into a path: through the index, and never outside the root.
export function resolveInLibrary(rel: string) {
  const root = path.resolve(libraryRoot());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Outside the library.');
  return abs;
}

// ---- names ----
const clean = (s: string) =>
  s
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// Show.Name.S02E05.1080p…, Show Name - 2x05, Film Name (2023), Film.Name.2023.1080p…
export function guessName(rel: string): Guess | undefined {
  const base = path.basename(rel).replace(VIDEO, '');
  const parent = path.basename(path.dirname(rel));
  for (const name of [base, `${parent} ${base}`]) {
    const ep = name.match(/^(.*?)[\s._-]*(?:S(\d{1,2})[\s._-]?E(\d{1,3})|(\d{1,2})x(\d{2,3}))\b/i);
    if (ep && clean(ep[1]))
      return { title: clean(ep[1]).replace(/\s*-\s*$/, ''), season: Number(ep[2] || ep[4]), number: Number(ep[3] || ep[5]) };
  }
  const film = base.match(/^(.*?)[\s._(\[-]+((?:19|20)\d{2})(?:[\s._)\]-]|$)/);
  if (film && clean(film[1])) return { title: clean(film[1]), year: film[2] };
  const title = clean(base.replace(/\b(1080p|720p|2160p|4k|web[- ]?dl|webrip|bluray|x264|x265|hevc|h264|aac|hdr)\b.*$/i, ''));
  return title ? { title } : undefined;
}
export const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
export const guessKey = (g: Guess) => (g.season !== undefined && g.number !== undefined ? episodeKey(g.season, g.number) : 'film');

// ---- scanning ----
function walk(dir: string, rootAbs: string, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, rootAbs, out);
    else if (e.isFile() && VIDEO.test(e.name) && !PARTIAL.test(e.name)) out.push(path.relative(rootAbs, abs));
  }
}
// Finds new, changed and removed files. A file is only picked up once its size
// and mtime have held still for a couple of minutes.
export async function scan(now = Date.now()) {
  const root = libraryRoot();
  for (const d of [...LIBRARY_DIRS, READY]) fs.mkdirSync(path.join(root, d), { recursive: true, mode: 0o700 });
  const rels: string[] = [];
  walk(path.resolve(root), path.resolve(root), rels);
  return withLibrary((l) => {
    const seen = new Set<string>();
    const res = { added: 0, settled: 0, removed: 0 };
    for (const rel of rels) {
      const id = fileIdOf(rel);
      seen.add(id);
      let st: fs.Stats;
      try {
        st = fs.statSync(resolveInLibrary(rel));
      } catch {
        continue;
      }
      const old = l.files[id];
      if (!old || old.size !== st.size || old.mtimeMs !== st.mtimeMs) {
        if (old?.playPath?.startsWith(READY)) fs.rmSync(resolveInLibrary(old.playPath), { force: true });
        l.files[id] = {
          id,
          rel,
          size: st.size,
          mtimeMs: st.mtimeMs,
          seenAt: new Date(now).toISOString(),
          status: 'settling',
          guess: guessName(rel),
          match: old?.match,
          subtitles: [],
        };
        if (!old) res.added++;
        continue;
      }
      if (old.status === 'settling' && now - Math.max(st.mtimeMs, Date.parse(old.seenAt)) >= SETTLE_MS) {
        old.status = 'new';
        res.settled++;
      }
    }
    for (const [id, f] of Object.entries(l.files))
      if (!seen.has(id)) {
        if (f.playPath?.startsWith(READY)) fs.rmSync(resolveInLibrary(f.playPath), { force: true });
        for (const s of f.subtitles) fs.rmSync(resolveInLibrary(s.file), { force: true });
        delete l.files[id];
        res.removed++;
      }
    l.scannedAt = new Date(now).toISOString();
    return res;
  });
}

// ---- probing and preparing ----
interface FfStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  channels?: number;
  tags?: { language?: string };
  disposition?: { default?: number };
}
export async function probeFile(abs: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs], {
    maxBuffer: 8 << 20,
    timeout: 60_000,
  });
  const j = JSON.parse(stdout) as { format?: { format_name?: string; duration?: string }; streams?: FfStream[] };
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png');
  return {
    durationSec: j.format?.duration ? Math.round(Number(j.format.duration)) : undefined,
    container: j.format?.format_name || '',
    video: v ? { codec: v.codec_name || '', width: v.width, height: v.height, pixFmt: v.pix_fmt } : undefined,
    audio: streams
      .filter((s) => s.codec_type === 'audio')
      .map((s) => ({ index: s.index, codec: s.codec_name || '', channels: s.channels, lang: s.tags?.language, isDefault: !!s.disposition?.default })),
    subs: streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s) => ({ index: s.index, codec: s.codec_name || '', lang: s.tags?.language })),
  };
}
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis']);
const TEXT_SUBS = new Set(['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
// The audio track to keep: English, then the default, then the first.
export const pickAudio = (p: Probe) =>
  p.audio.find((a) => a.lang === 'eng') || p.audio.find((a) => a.isDefault) || p.audio[0];
// What it takes for a browser to play this file, cheapest first.
// ffprobe calls both .mkv and .webm "matroska,webm"; only a real .webm plays as it is.
export function planFor(p: Probe, rel = ''): PrepPlan {
  const v = p.video;
  const a = pickAudio(p);
  if (!v) return 'transcode';
  const h264 = v.codec === 'h264' && (!v.pixFmt || v.pixFmt === 'yuv420p');
  const audioOk = !a || BROWSER_AUDIO.has(a.codec);
  const mp4 = /mp4|mov|m4v/.test(p.container);
  const webm = /\.webm$/i.test(rel) && ['vp8', 'vp9', 'av1'].includes(v.codec) && (!a || ['opus', 'vorbis'].includes(a.codec));
  if (webm && p.audio.length <= 1) return 'direct';
  // VP9 and AV1 play from an mp4 in current browsers; copying beats a transcode.
  if (['vp9', 'av1'].includes(v.codec) && (!a || ['opus', 'aac'].includes(a.codec))) return 'remux';
  if (h264 && audioOk && mp4 && p.audio.length <= 1) return 'direct';
  if (h264 && audioOk) return 'remux';
  if (h264) return 'audio';
  return 'transcode';
}
export function ffmpegArgs(inAbs: string, outAbs: string, plan: Exclude<PrepPlan, 'direct'>, p: Probe) {
  const a = pickAudio(p);
  const maps = ['-map', '0:v:0', ...(a ? ['-map', `0:${a.index}`] : [])];
  const video =
    plan === 'transcode'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-vf', "scale='min(1920,iw)':-2"]
      : ['-c:v', 'copy'];
  const audio = !a ? [] : plan === 'remux' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k'];
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', inAbs, ...maps, ...video, ...audio, '-sn', '-movflags', '+faststart', '-f', 'mp4', outAbs];
}
async function ffmpeg(args: string[], timeoutMs: number) {
  await run('nice', ['-n', '15', 'ffmpeg', ...args], { maxBuffer: 8 << 20, timeout: timeoutMs });
}
// Embedded text subtitles and same-named .srt/.vtt files next to the video become WebVTT.
async function extractSubtitles(f: LibFile, abs: string, p: Probe) {
  const out: { lang: string; file: string }[] = [];
  const text = p.subs.filter((s) => TEXT_SUBS.has(s.codec)).slice(0, 6);
  for (const [i, s] of text.entries()) {
    const file = path.join(READY, `${f.id}.${i}.vtt`);
    try {
      await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', abs, '-map', `0:${s.index}`, '-f', 'webvtt', resolveInLibrary(file)], 120_000);
      out.push({ lang: s.lang || 'und', file });
    } catch {
      /* A broken track: skip it. */
    }
  }
  const dir = path.dirname(abs),
    stem = path.basename(abs).replace(VIDEO, '');
  let sidecars: string[] = [];
  try {
    sidecars = fs.readdirSync(dir).filter((n) => n.startsWith(stem) && SUBS.test(n));
  } catch {
    /* No folder listing: no sidecars. */
  }
  for (const [i, n] of sidecars.slice(0, 4).entries()) {
    const file = path.join(READY, `${f.id}.side${i}.vtt`);
    try {
      await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, n), '-f', 'webvtt', resolveInLibrary(file)], 60_000);
      out.push({ lang: n.slice(stem.length).replace(SUBS, '').replace(/^[._-]+/, '') || 'und', file });
    } catch {
      /* Not a subtitle ffmpeg can read. */
    }
  }
  return out;
}
// Probes one settled file and makes it playable. Long transcodes run with low priority.
export async function prepare(id: string) {
  const f = readLibrary().files[id];
  if (!f || f.status !== 'new') return undefined;
  await withLibrary((l) => {
    if (l.files[id]) l.files[id].status = 'preparing';
  });
  const abs = resolveInLibrary(f.rel);
  try {
    const p = await probeFile(abs);
    const plan = planFor(p, f.rel);
    let playPath = f.rel;
    if (plan !== 'direct') {
      playPath = path.join(READY, `${f.id}.mp4`);
      const tmp = resolveInLibrary(path.join(READY, `${f.id}.part.mp4`));
      // Real time is plenty for copies; a transcode gets up to 3x the running time.
      const budget = Math.max(10 * 60_000, (p.durationSec || 3600) * 1000 * (plan === 'transcode' ? 3 : 0.5));
      await ffmpeg(ffmpegArgs(abs, tmp, plan, p), budget);
      fs.renameSync(tmp, resolveInLibrary(playPath));
    }
    const subtitles = await extractSubtitles(f, abs, p);
    return withLibrary((l) => {
      const cur = l.files[id];
      if (!cur) return undefined;
      Object.assign(cur, { probe: p, plan, playPath, subtitles, status: 'ready', readyAt: new Date().toISOString() });
      delete cur.error;
      return cur;
    });
  } catch (e) {
    fs.rmSync(resolveInLibrary(path.join(READY, `${f.id}.part.mp4`)), { force: true });
    return withLibrary((l) => {
      const cur = l.files[id];
      if (!cur) return undefined;
      cur.status = 'failed';
      cur.error = ((e as Error).message || 'ffmpeg failed').slice(0, 300);
      return cur;
    });
  }
}
export async function setMatch(id: string, match: { showId: string; key: string } | null, by: string) {
  return withLibrary((l) => {
    const f = l.files[id];
    if (!f) throw new Error('That file is no longer in the library.');
    if (match) f.match = { ...match, by, at: new Date().toISOString() };
    else delete f.match;
    return f;
  });
}
export async function retry(id: string) {
  return withLibrary((l) => {
    const f = l.files[id];
    if (!f) throw new Error('That file is no longer in the library.');
    if (f.status === 'failed') {
      f.status = 'new';
      delete f.error;
    }
    return f;
  });
}
// Copies or hard-links a file into the inbox (for scripts that finish a download elsewhere).
export function importFile(src: string, mode: 'link' | 'move' | 'copy' = 'link') {
  if (!VIDEO.test(src)) throw new Error('Not a video file.');
  const dest = path.join(libraryRoot(), 'inbox', path.basename(src));
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  if (fs.existsSync(dest)) throw new Error('A file with that name is already in the inbox.');
  if (mode === 'move') fs.renameSync(src, dest);
  else if (mode === 'copy') fs.copyFileSync(src, dest);
  else {
    try {
      fs.linkSync(src, dest);
    } catch {
      fs.copyFileSync(src, dest);
    }
  }
  return path.relative(libraryRoot(), dest);
}
