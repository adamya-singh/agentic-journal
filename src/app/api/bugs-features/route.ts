import { NextRequest } from 'next/server';
import { createItem, listItems, toView } from '@/lib/bugs-features/store';
import { authorized, errorResponse, failure, itemResult, readForm, result } from './route-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return result(listItems().map(toView));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return failure('A same-origin request is required.', 403);
  try {
    const { input, images } = await readForm(req);
    return itemResult(createItem(input, images), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
