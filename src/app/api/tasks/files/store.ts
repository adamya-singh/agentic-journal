// A task's real files on disk: found inside OpenClaw's workspace folder and nowhere else, described, and a PDF's
// pages drawn to images (pdftoppm) and kept until the file changes. The path never comes from a request: the route
// asks for a task's `file` block and this reads the path that block holds.
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { tasksDataDir } from '@/lib/backend-data';
import { readBlocks } from '@/lib/hook-work';
import type { FileBlock } from '@/lib/shapes/work';
import { fileFolder, fileKind, fileName, type FileMeta, type PageWidth } from '@/lib/task-files';
import { loadTaskBrief } from '../brief/build';
import { readHookWorkRecord } from '../hook-work/store';

const run = promisify(execFile);

/** Nothing bigger is read, drawn or sent. */
export const FILE_MAX_BYTES = 200 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;

/** OpenClaw's workspace folder: the only place a task's files are read from. */
export function workspaceRoot(): string {
  return process.env.OPENCLAW_WORKSPACE_DIR || path.join(os.homedir(), '.openclaw', 'workspace');
}

export interface FoundFile { abs: string; rel: string; size: number; mtime: number }

/**
 * The file at a path inside the workspace folder, or null: when it is not there, is not a plain file, is too big,
 * or is not really inside the folder (the path climbs out, or a link along it leads out).
 */
export function findWorkspaceFile(rel: string): FoundFile | null {
  try {
    const root = fs.realpathSync(workspaceRoot());
    const asked = path.resolve(root, rel);
    if (asked !== root && !asked.startsWith(root + path.sep)) return null;
    const abs = fs.realpathSync(asked);
    if (!abs.startsWith(root + path.sep)) return null;
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > FILE_MAX_BYTES) return null;
    return { abs, rel, size: stat.size, mtime: Math.round(stat.mtimeMs) };
  } catch {
    return null;
  }
}

/** The `file` block of a task's work with this id: from the workspace's own version of the blocks, else the brief's. */
export function fileBlockOf(taskId: string, blockId: string): FileBlock | null {
  const blocks = readBlocks(readHookWorkRecord(taskId)?.body) ?? loadTaskBrief(taskId)?.hook?.work?.blocks ?? [];
  const block = blocks.find((each) => each.id === blockId);
  return block?.kind === 'file' ? block : null;
}

// ---- A PDF's pages.

const cacheRoot = () => path.join(tasksDataDir(), 'file-cache');
const pathKey = (abs: string) => createHash('sha1').update(abs).digest('hex').slice(0, 16);
/** One folder per version of a file: when the file is written again, its pages are drawn again. */
const cacheDir = (file: FoundFile) => path.join(cacheRoot(), `${pathKey(file.abs)}-${file.mtime}-${file.size}`);

/** The pages drawn from earlier versions of this file are no use any more. */
function dropOlderVersions(file: FoundFile): void {
  const mine = path.basename(cacheDir(file));
  try {
    for (const name of fs.readdirSync(cacheRoot())) {
      if (name !== mine && name.startsWith(`${pathKey(file.abs)}-`)) fs.rmSync(path.join(cacheRoot(), name), { recursive: true, force: true });
    }
  } catch { /* nothing kept yet */ }
}

interface PdfFacts { pages: number; ratio: number | null }
const facts = new Map<string, PdfFacts | null>();

/** How many pages a PDF has and the shape of its first page (pdfinfo). Null when it could not be read. */
export async function pdfFacts(file: FoundFile): Promise<PdfFacts | null> {
  const key = cacheDir(file);
  if (facts.has(key)) return facts.get(key) ?? null;
  let read: PdfFacts | null = null;
  try {
    const { stdout } = await run('pdfinfo', [file.abs], { timeout: RENDER_TIMEOUT_MS, maxBuffer: 1 << 20 });
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
    const size = /^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(stdout);
    const ratio = size && Number(size[2]) > 0 ? Number(size[1]) / Number(size[2]) : null;
    if (Number.isInteger(pages) && pages > 0) read = { pages, ratio: ratio && Number.isFinite(ratio) && ratio > 0 ? ratio : null };
  } catch { /* not a PDF that can be read, or pdfinfo is not installed */ }
  if (facts.size > 200) facts.clear();
  facts.set(key, read);
  return read;
}

const drawing = new Map<string, Promise<string | null>>();

/** One page of a PDF as a PNG this wide, drawn once per version of the file. The image's path, or null. */
export function pdfPage(file: FoundFile, page: number, width: PageWidth): Promise<string | null> {
  const dir = cacheDir(file);
  const out = path.join(dir, `p${page}-w${width}.png`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const going = drawing.get(out);
  if (going) return going;
  const draw = (async () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      dropOlderVersions(file);
      // Drawn beside its place and moved in whole, so a half-written image is never sent.
      const tmp = path.join(dir, `.p${page}-w${width}-${process.pid}-${Date.now()}`);
      await run('nice', ['-n', '10', 'pdftoppm', '-f', String(page), '-l', String(page), '-scale-to-x', String(width), '-scale-to-y', '-1', '-png', '-singlefile', file.abs, tmp],
        { timeout: RENDER_TIMEOUT_MS, maxBuffer: 1 << 20 });
      fs.renameSync(`${tmp}.png`, out);
      return out;
    } catch (error) {
      console.error('task files: a page could not be drawn:', error instanceof Error ? error.message : error);
      return null;
    } finally {
      drawing.delete(out);
    }
  })();
  drawing.set(out, draw);
  return draw;
}

/** What a file is, as it is on disk now. */
export async function fileMeta(file: FoundFile): Promise<FileMeta> {
  const kind = fileKind(file.rel);
  const pdf = kind === 'pdf' ? await pdfFacts(file) : null;
  return { name: fileName(file.rel), folder: fileFolder(file.rel), kind, size: file.size, mtime: file.mtime, pages: pdf?.pages ?? null, ratio: pdf?.ratio ?? null };
}
