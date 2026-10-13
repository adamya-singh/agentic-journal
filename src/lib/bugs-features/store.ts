import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { backendDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { BugFeature, BugFeatureKind, BugFeatureStatus, BugFeatureView } from './types';

// Every function here is synchronous on purpose: Node runs each one to completion, so two
// requests in this process can never interleave a read-modify-write of items.json.

export const MAX_IMAGES = 12;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT = 20_000;

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const CONTENT_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_TYPES).map(([type, ext]) => [ext, type]),
);
const ID_RE = /^bf_[0-9a-f]{8}$/;
// Random names, never reused, so a screenshot URL can be cached forever.
const IMAGE_NAME_RE = /^[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

export class BugFeatureError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface NewImage {
  data: Buffer;
  type: string;
}

export interface BugFeatureInput {
  kind: BugFeatureKind;
  description: string;
  prompt: string;
  page: string | null;
}

interface StoreFile {
  version: 1;
  items: BugFeature[];
}

export const bugsFeaturesDir = () => path.join(backendDataDir(), 'bugs-features');
const itemsFile = () => path.join(bugsFeaturesDir(), 'items.json');
const imageDir = (id: string) => path.join(bugsFeaturesDir(), 'images', id);

function readItems(): BugFeature[] {
  try {
    return (JSON.parse(fs.readFileSync(itemsFile(), 'utf8')) as StoreFile).items;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new BugFeatureError('Bugs/Features storage could not be read. Check items.json.', 500);
  }
}

function writeItems(items: BugFeature[]) {
  writeJsonFileAtomic(itemsFile(), { version: 1, items } satisfies StoreFile);
}

function findIndex(items: BugFeature[], id: string): number {
  const index = ID_RE.test(id) ? items.findIndex((item) => item.id === id) : -1;
  if (index < 0) throw new BugFeatureError('That bug or feature no longer exists.', 404);
  return index;
}

function checkInput(input: BugFeatureInput, imageCount: number) {
  if (input.description.length > MAX_TEXT || input.prompt.length > MAX_TEXT) {
    throw new BugFeatureError(`Description and prompt are limited to ${MAX_TEXT} characters each.`);
  }
  if (!input.description.trim() && !input.prompt.trim() && imageCount === 0) {
    throw new BugFeatureError('Add a screenshot, description, or prompt first.');
  }
  if (imageCount > MAX_IMAGES) {
    throw new BugFeatureError(`Keep it to ${MAX_IMAGES} screenshots or fewer.`);
  }
}

function checkImages(images: NewImage[]) {
  for (const image of images) {
    if (!IMAGE_TYPES[image.type]) {
      throw new BugFeatureError('Screenshots must be PNG, JPEG, WebP, or GIF images.');
    }
    if (image.data.length > MAX_IMAGE_BYTES) {
      throw new BugFeatureError('Each screenshot must be under 15 MB.');
    }
  }
}

/** Writes new screenshots and returns their file names. */
function writeImages(id: string, images: NewImage[]): string[] {
  if (!images.length) return [];
  fs.mkdirSync(imageDir(id), { recursive: true });
  return images.map((image) => {
    const name = `${randomBytes(6).toString('hex')}.${IMAGE_TYPES[image.type]}`;
    fs.writeFileSync(path.join(imageDir(id), name), image.data);
    return name;
  });
}

function removeImages(id: string, names: string[]) {
  for (const name of names) fs.rmSync(path.join(imageDir(id), name), { force: true });
}

export function toView(item: BugFeature): BugFeatureView {
  return {
    ...item,
    imageUrls: item.images.map((name) => `/api/bugs-features/${item.id}/images/${name}`),
    imagePaths: item.images.map((name) => path.join(imageDir(item.id), name)),
  };
}

/** Newest first. */
export function listItems(): BugFeature[] {
  return readItems().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createItem(
  input: BugFeatureInput,
  images: NewImage[],
  now = new Date(),
): BugFeature {
  checkInput(input, images.length);
  checkImages(images);
  const items = readItems();
  let id: string;
  do id = `bf_${randomBytes(4).toString('hex')}`;
  while (items.some((item) => item.id === id));
  const stamp = now.toISOString();
  const item: BugFeature = {
    id,
    ...input,
    images: writeImages(id, images),
    status: 'open',
    createdAt: stamp,
    updatedAt: stamp,
    shippedAt: null,
  };
  writeItems([...items, item]);
  return item;
}

/** Replaces the text fields, keeps the listed screenshots in that order, and appends new ones. */
export function updateItem(
  id: string,
  input: BugFeatureInput,
  keepImages: string[],
  images: NewImage[],
  now = new Date(),
): BugFeature {
  const items = readItems();
  const index = findIndex(items, id);
  const current = items[index];
  const kept = keepImages.filter(
    (name, i) => current.images.includes(name) && keepImages.indexOf(name) === i,
  );
  checkInput(input, kept.length + images.length);
  checkImages(images);
  const added = writeImages(id, images);
  const item: BugFeature = {
    ...current,
    ...input,
    images: [...kept, ...added],
    updatedAt: now.toISOString(),
  };
  items[index] = item;
  writeItems(items);
  removeImages(
    id,
    current.images.filter((name) => !kept.includes(name)),
  );
  return item;
}

export function setStatus(id: string, status: BugFeatureStatus, now = new Date()): BugFeature {
  const items = readItems();
  const index = findIndex(items, id);
  const stamp = now.toISOString();
  items[index] = {
    ...items[index],
    status,
    updatedAt: stamp,
    shippedAt: status === 'shipped' ? stamp : null,
  };
  writeItems(items);
  return items[index];
}

export function deleteItem(id: string) {
  const items = readItems();
  const index = findIndex(items, id);
  items.splice(index, 1);
  writeItems(items);
  fs.rmSync(imageDir(id), { recursive: true, force: true });
}

export function readImage(id: string, name: string): { data: Buffer; type: string } | null {
  const match = IMAGE_NAME_RE.exec(name);
  if (!ID_RE.test(id) || !match) return null;
  try {
    return { data: fs.readFileSync(path.join(imageDir(id), name)), type: CONTENT_TYPES[match[1]] };
  } catch {
    return null;
  }
}
