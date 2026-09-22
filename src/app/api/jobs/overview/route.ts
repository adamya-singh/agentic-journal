import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { MutationSchema, readExtras, readOverview, saveJson, withOverviewLock } from './store';
import { reportState } from './analysis/service';
import { summarize, groupOpportunities } from '@/lib/job-overview';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const data = readOverview();
    const q = request.nextUrl.searchParams;
    const base =
      q.get('unique') === 'true' ? groupOpportunities(data.rows, data.groups) : data.rows;
    const rows = base.filter(
      (r) =>
        (!q.get('company') || r.company === q.get('company')) &&
        (!q.get('resume') || r.resume === q.get('resume')) &&
        (!q.get('outcome') || !!r.first[q.get('outcome')!]) &&
        (!q.get('from') ||
          (r.submittedAt && Date.parse(r.submittedAt) >= Date.parse(q.get('from')!))) &&
        (!q.get('to') || (r.submittedAt && Date.parse(r.submittedAt) <= Date.parse(q.get('to')!))),
    );
    const windowDays = Number(q.get('windowDays') ?? 14);
    if (![7, 14, 30].includes(windowDays))
      return NextResponse.json({ error: 'windowDays must be 7, 14, or 30' }, { status: 400 });
    return NextResponse.json({
      ...data,
      rows,
      metrics: summarize(rows, windowDays),
      analysis: reportState(data),
    });
  } catch {
    return NextResponse.json({ error: 'Unable to read overview data' }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  try {
    const input = MutationSchema.parse(await request.json());
    const result = await withOverviewLock('overview-metadata', async () => {
      const data = readExtras(),
        view = readOverview();
      if (input.action === 'milestone') {
        if (!view.rows.some((r) => r.id === input.listingId && r.submitted))
          throw new Error('Choose a submitted application');
        if (
          Date.parse(input.occurredAt) > Date.now() + 60000 &&
          input.kind !== 'interview-scheduled'
        )
          throw new Error('Completed milestones cannot be in the future');
        const list = data.milestones[input.listingId] ?? [];
        if (
          input.supersedes &&
          (!list.some((m) => m.id === input.supersedes) ||
            list.some((m) => m.supersedes === input.supersedes))
        )
          throw new Error('Correction target is missing or already corrected');
        list.push({
          id: randomUUID(),
          source: 'manual',
          createdAt: new Date().toISOString(),
          kind: input.kind,
          occurredAt: input.occurredAt,
          note: input.note,
          ...(input.supersedes ? { supersedes: input.supersedes } : {}),
        });
        data.milestones[input.listingId] = list;
      } else if (input.action === 'group') {
        const ids = [...new Set(input.listingIds)];
        if (ids.length < 2 || ids.some((id) => !view.rows.some((r) => r.id === id && r.submitted)))
          throw new Error('Choose at least two submitted records');
        if (data.groups.some((g) => g.listingIds.some((id) => ids.includes(id))))
          throw new Error('Remove the existing group before regrouping');
        data.groups.push({ id: randomUUID(), listingIds: ids });
      } else data.groups = data.groups.filter((g) => g.id !== input.id);
      saveJson('overview-metadata.json', data);
      return { success: true };
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid update' },
      { status: 400 },
    );
  }
}
