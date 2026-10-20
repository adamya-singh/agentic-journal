import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { backendDataDir } from '@/lib/backend-data';

// Images pasted into Quick Capture. They live beside the task data and are linked from the
// captured task's notes as markdown images, so every notes renderer shows them.

export const MAX_CAPTURE_IMAGES = 8;
export const MAX_CAPTURE_IMAGE_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const CONTENT_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_TYPES).map(([type, ext]) => [ext, type]),
);
// Random names, never reused, so an image URL can be cached forever.
const IMAGE_NAME_RE = /^[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

export interface CaptureImage {
  data: Buffer;
  type: string;
}

export class CaptureImageError extends Error {}

const imageDir = () => path.join(backendDataDir(), 'capture-images');

export const captureImageUrl = (name: string) => `/api/capture/images/${name}`;

export function checkCaptureImages(images: CaptureImage[]) {
  if (images.length > MAX_CAPTURE_IMAGES) {
    throw new CaptureImageError(`Keep it to ${MAX_CAPTURE_IMAGES} images or fewer.`);
  }
  for (const image of images) {
    if (!IMAGE_TYPES[image.type]) {
      throw new CaptureImageError('Images must be PNG, JPEG, WebP, or GIF.');
    }
    if (image.data.length > MAX_CAPTURE_IMAGE_BYTES) {
      throw new CaptureImageError('Each image must be under 15 MB.');
    }
  }
}

/** Writes the images and returns their file names. */
export function saveCaptureImages(images: CaptureImage[]): string[] {
  checkCaptureImages(images);
  if (!images.length) return [];
  fs.mkdirSync(imageDir(), { recursive: true });
  return images.map((image) => {
    const name = `${randomBytes(6).toString('hex')}.${IMAGE_TYPES[image.type]}`;
    fs.writeFileSync(path.join(imageDir(), name), image.data);
    return name;
  });
}

export function removeCaptureImages(names: string[]) {
  for (const name of names) {
    if (IMAGE_NAME_RE.test(name)) fs.rmSync(path.join(imageDir(), name), { force: true });
  }
}

export function readCaptureImage(name: string): { data: Buffer; type: string } | null {
  const match = IMAGE_NAME_RE.exec(name);
  if (!match) return null;
  try {
    return { data: fs.readFileSync(path.join(imageDir(), name)), type: CONTENT_TYPES[match[1]] };
  } catch {
    return null;
  }
}

/** One markdown image line per image, for the task's notes. */
export function captureImagesMarkdown(names: string[]): string {
  return names
    .map((name, i) => `![Pasted image ${i + 1}](${captureImageUrl(name)})`)
    .join('\n');
}
