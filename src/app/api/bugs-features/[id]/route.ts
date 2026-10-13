import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteItem, setStatus, updateItem } from '@/lib/bugs-features/store';
import { authorized, errorResponse, failure, itemResult, readForm, result } from '../route-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Edit: the same multipart body as create, plus keepImages (JSON array of existing file names). */
export async function PUT(req: NextRequest, { params }: Context) {
  if (!authorized(req)) return failure('A same-origin request is required.', 403);
  try {
    const { id } = await params;
    const { input, keepImages, images } = await readForm(req);
    return itemResult(updateItem(id, input, keepImages, images));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Mark shipped or reopen. */
export async function PATCH(req: NextRequest, { params }: Context) {
  if (!authorized(req)) return failure('A same-origin request is required.', 403);
  try {
    const { id } = await params;
    const { status } = z
      .object({ status: z.enum(['open', 'shipped']) })
      .strict()
      .parse(await req.json());
    return itemResult(setStatus(id, status));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  if (!authorized(req)) return failure('A same-origin request is required.', 403);
  try {
    const { id } = await params;
    deleteItem(id);
    return result({ id });
  } catch (e) {
    return errorResponse(e);
  }
}
