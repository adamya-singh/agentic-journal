import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  BugFeatureError,
  MAX_IMAGES,
  toView,
  type BugFeatureInput,
  type NewImage,
} from '@/lib/bugs-features/store';
import { BUG_FEATURE_KINDS, type BugFeature } from '@/lib/bugs-features/types';

export const result = (data: unknown, status = 200) =>
  NextResponse.json({ success: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });

export const failure = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

export const itemResult = (item: BugFeature, status = 200) => result(toView(item), status);

/** Writes need a same-origin browser request: the origins /api/media accepts, or one matching the Host header (test instances on other ports). */
export function authorized(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const allowed = [
    new URL(process.env.AGENTIC_JOURNAL_ORIGIN || 'https://ubuntu-laptop.taile85e97.ts.net').origin,
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ];
  try {
    return allowed.includes(origin) || new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

const FieldsSchema = z.object({
  kind: z.enum(BUG_FEATURE_KINDS),
  description: z.string(),
  prompt: z.string(),
  page: z.string().max(2000),
});

/** Reads the multipart body the drawer sends on Save: text fields, kept screenshot names, and new screenshots. */
export async function readForm(
  req: NextRequest,
): Promise<{ input: BugFeatureInput; keepImages: string[]; images: NewImage[] }> {
  const form = await req.formData();
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };
  const fields = FieldsSchema.parse({
    kind: text('kind'),
    description: text('description'),
    prompt: text('prompt'),
    page: text('page'),
  });
  const keepImages = z
    .array(z.string())
    .max(MAX_IMAGES)
    .parse(JSON.parse(text('keepImages') || '[]'));
  const files = form.getAll('images').filter((value): value is File => typeof value !== 'string');
  if (files.length > MAX_IMAGES)
    throw new BugFeatureError(`Keep it to ${MAX_IMAGES} screenshots or fewer.`);
  const images = await Promise.all(
    files.map(async (file) => ({ data: Buffer.from(await file.arrayBuffer()), type: file.type })),
  );
  return { input: { ...fields, page: fields.page.trim() || null }, keepImages, images };
}

export function errorResponse(e: unknown) {
  if (e instanceof BugFeatureError) return failure(e.message, e.status);
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return failure('Invalid bugs/features request.');
  console.error('Bugs/Features request failed:', e);
  return failure('Saving failed. Check the server log.', 500);
}
