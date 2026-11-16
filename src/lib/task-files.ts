// The real files of a task: what a `file` block of its work names (lib/shapes/work.ts), shown in the workspace as
// the thing itself (a PDF page by page, a document, an image) and not as a copy typed into the Journal.
// Pure: no filesystem, so the page, the route and the tests share it. Reading the file is the route's
// (app/api/tasks/files).

/** How the workspace shows a file. Anything it cannot show as it is ("other") is offered to download. */
export type FileKind = 'pdf' | 'image' | 'markdown' | 'text' | 'other';

const KINDS: Record<string, FileKind> = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  md: 'markdown', markdown: 'markdown',
  txt: 'text', csv: 'text', tsv: 'text', json: 'text', log: 'text', tex: 'text', bib: 'text',
  py: 'text', js: 'text', ts: 'text', sh: 'text', yaml: 'text', yml: 'text', sql: 'text', r: 'text',
};

/** "deck/Talk.PDF" → "pdf"; "" when the name has no extension. */
export function fileExt(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The folder a file is in, as a path inside the workspace folder; "" at its top. */
export const fileFolder = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export const fileKind = (path: string): FileKind => KINDS[fileExt(path)] ?? 'other';

/** What the browser is told a file is. Only what the workspace shows as it is gets a type of its own. */
const TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
};
export function fileType(path: string): string {
  const ext = fileExt(path);
  return TYPES[ext] ?? (fileKind(path) === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream');
}

/** The widths a PDF page is drawn at: the navigator's thumbnail, the page on the stage, and the stage on a dense screen. */
export const PAGE_WIDTHS = [320, 1600, 2400] as const;
export type PageWidth = typeof PAGE_WIDTHS[number];
/** The drawn width for a width asked for: the smallest that is at least as wide, else the widest. */
export function pageWidth(asked: number): PageWidth {
  return PAGE_WIDTHS.find((width) => width >= asked) ?? PAGE_WIDTHS[PAGE_WIDTHS.length - 1]!;
}

/** What the route says about a file as it is on disk now. */
export interface FileMeta {
  name: string;
  folder: string;                // inside OpenClaw's workspace folder
  kind: FileKind;
  size: number;                  // bytes
  mtime: number;                 // ms; changes when the file is written again
  pages: number | null;          // a PDF's page count, when it could be read
  ratio: number | null;          // a PDF page's width over its height
}

/** "748 KB", "1.2 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The address of a file of a task's work: what it is (no extra), one page of a PDF drawn, or the file itself. */
export function fileUrl(taskId: string, block: string, extra: { page: number; width: PageWidth; v: number } | { raw: true; v?: number; download?: boolean } | null = null): string {
  const base = `/api/tasks/files?id=${encodeURIComponent(taskId)}&block=${encodeURIComponent(block)}`;
  if (extra === null) return base;
  if ('raw' in extra) return `${base}&raw=1${extra.download ? '&dl=1' : ''}${extra.v ? `&v=${Math.round(extra.v)}` : ''}`;
  return `${base}&page=${extra.page}&w=${extra.width}&v=${Math.round(extra.v)}`;
}
