// The surfaces of a task's workspace: one per real file of its work (a `file` block: the PDF, the document, shown
// as it is), the work OpenClaw started in blocks (or the place to start it), and one web page per real link the
// task has, shown in OpenClaw's own browser. Nothing here is made up: a task with no files has no file surfaces,
// and one with no links has no web surfaces until he pastes an address himself.
// Pure: the page, the browser route and the tests share it.
import { fileExt, fileName } from '@/lib/task-files';

export interface WorkSurface { id: 'work'; kind: 'work'; label: string }
export interface WebSurface {
  id: string;                    // "web:<address>"
  kind: 'web';
  label: string;
  url: string;
  tag: string;                   // a word for where it leads: "canvas", "posting", "link"
  pasted?: true;                 // he added it himself
}
export interface FileSurface {
  id: string;                    // "file:<block id>"
  kind: 'file';
  block: string;                 // the id of the work's `file` block
  label: string;
  path: string;                  // inside OpenClaw's workspace folder
  tag: string;                   // its extension: "pdf", "md"
}
export type Surface = WorkSurface | WebSurface | FileSurface;

export interface SurfaceInputs {
  links: { label: string; href: string; kind: string }[];
  next: { label: string; href?: string } | null;
  /** `blocks` counts the blocks he works in: the work's blocks that are not files. */
  work: { title: string; href: string | null; blocks: number } | null;
  pasted?: string[];
  /** The work's `file` blocks, in their order. */
  files?: { id: string; path: string; label?: string }[];
}

const MAX_URL = 2000;

/**
 * An address OpenClaw's browser may be sent to: http or https, nothing else. A bare "example.com/page" gets
 * https. Returns the normalised address, or null for anything that is not a web page (javascript:, file:, data:,
 * about:, chrome:, an address with a password in it, or words that are not an address).
 */
export function safeWebUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (raw === '' || raw.length > MAX_URL || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/:]+:\d+(\/|$)/.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try { parsed = new URL(withScheme); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) return null;
  return parsed.href;
}

/** Two addresses are the same page: same site, path and query, whatever the fragment, "www." or a trailing slash. */
export function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return url;
  }
}

export const surfaceId = (url: string) => `web:${pageKey(url)}`;
export const fileSurfaceId = (block: string) => `file:${block}`;

function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * The workspace's tabs, in order: the task's files, the work (left out when the files are all the work there is),
 * then the place the next step leads, the place the started work gets finished, the task's links, and the pages
 * he pasted. One tab per page however many times it is linked.
 */
export function deriveSurfaces(input: SurfaceInputs): Surface[] {
  const web: WebSurface[] = [];
  const seen = new Set<string>();
  const add = (href: string | null | undefined, label: string, tag: string, pasted = false) => {
    const url = safeWebUrl(href);
    if (url === null || !/^https?:\/\//i.test((href ?? '').trim()) && !pasted) return;
    const key = pageKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    web.push({ id: surfaceId(url), kind: 'web', label: label.trim() || hostLabel(url), url, tag, ...(pasted ? { pasted: true as const } : {}) });
  };
  if (input.next?.href) add(input.next.href, input.next.label, 'start');
  if (input.work?.href) add(input.work.href, hostLabel(input.work.href), 'finish');
  for (const link of input.links) add(link.href, link.label, link.kind === 'app' ? 'journal' : link.kind);
  for (const url of input.pasted ?? []) add(url, hostLabel(url), 'page', true);
  const files: FileSurface[] = (input.files ?? []).map((file) => ({
    id: fileSurfaceId(file.id), kind: 'file', block: file.id, label: file.label?.trim() || fileName(file.path), path: file.path, tag: fileExt(file.path) || 'file',
  }));
  const work: WorkSurface[] = files.length > 0 && (input.work?.blocks ?? 0) === 0 ? [] : [{ id: 'work', kind: 'work', label: input.work?.title.trim() || 'Work' }];
  return [...files, ...work, ...web];
}

/**
 * The tab a task opens on: its first file when it has one (the thing being worked on), else the work when OpenClaw
 * started some, else its first page, else the empty work tab.
 */
export function defaultSurfaceId(surfaces: Surface[], hasWork: boolean): string {
  const file = surfaces.find((surface) => surface.kind === 'file');
  if (file) return file.id;
  if (hasWork) return 'work';
  return surfaces.find((surface) => surface.kind === 'web')?.id ?? 'work';
}

// ---- The pages he pasted, kept per task so they are there when he opens the task again.

export const MAX_PASTED_PAGES = 24;

/** The list with this page on it (once, at the end). Null when it is not a web address. */
export function withPastedPage(pasted: string[], input: unknown): string[] | null {
  const url = safeWebUrl(input);
  if (url === null) return null;
  const key = pageKey(url);
  if (pasted.some((have) => pageKey(have) === key)) return pasted;
  return [...pasted, url].slice(-MAX_PASTED_PAGES);
}

/** The list without this page, under whichever spelling of its address. */
export function withoutPastedPage(pasted: string[], url: string): string[] {
  const key = pageKey(safeWebUrl(url) ?? url);
  return pasted.filter((have) => pageKey(have) !== key);
}

/** A stored list read back carefully: web addresses only, one per page. */
export function readPastedPages(raw: unknown): string[] {
  let out: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) out = withPastedPage(out, item) ?? out;
  return out;
}
