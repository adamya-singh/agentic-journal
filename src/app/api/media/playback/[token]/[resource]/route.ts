import { proxyPlayback } from '@/lib/media/jellyfin-playback';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, context: { params: Promise<{ token: string; resource: string }> }) {
  const { token, resource } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{24}$/.test(resource)) return new Response(null, { status: 404 });
  try { return await proxyPlayback(token, resource, req); }
  catch { return new Response('Playback unavailable.', { status: 502 }); }
}
