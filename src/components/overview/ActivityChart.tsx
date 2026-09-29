'use client';

import React from 'react';
import { BarChart3 } from 'lucide-react';
import type { JobEmployerStage } from '@/lib/types';
import { JOB_EMPLOYER_STAGE_LABELS } from '@/lib/job-email-updates';
import { STAGE_ORDER, type ActivityBucket } from '@/lib/job-overview-view';
import { Card, CardHeader, EmptyLine, InfoTip } from './primitives';

// One fixed hue per stage, matching EmployerStageBadge; validated for CVD
// separation in both themes (dataviz palette check: 500 steps on white, 600 steps on the dark surface).
const STAGE_FILL: Record<JobEmployerStage, string> = {
  received: 'fill-emerald-500 dark:fill-emerald-600',
  assessment: 'fill-amber-500 dark:fill-amber-600',
  interview: 'fill-violet-500',
  offer: 'fill-teal-500 dark:fill-teal-600',
  rejected: 'fill-red-500',
};
const STAGE_DOT: Record<JobEmployerStage, string> = {
  received: 'bg-emerald-500 dark:bg-emerald-600',
  assessment: 'bg-amber-500 dark:bg-amber-600',
  interview: 'bg-violet-500',
  offer: 'bg-teal-500 dark:bg-teal-600',
  rejected: 'bg-red-500',
};
const MAX_DOTS = 4;
const PAD = { top: 12, right: 8, bottom: 22, left: 28 };
const HEIGHT = 190;

const monthDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const label = (b: ActivityBucket) => (b.end && b.end !== b.day ? `${monthDay(b.day)} – ${monthDay(b.end)}` : monthDay(b.day));

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Submissions per day (or per week for long ranges) with employer responses
 * marked above each bar. Hover for the numbers; click a bar to narrow the
 * table to that day.
 */
export function ActivityChart({
  series,
  selectedDay,
  onSelectDay,
}: {
  series: { unit: 'day' | 'week'; buckets: ActivityBucket[] };
  selectedDay: string;
  onSelectDay: (day: string) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const { buckets, unit } = series;
  const n = buckets.length;
  const stagesPresent = STAGE_ORDER.filter((s) =>
    buckets.some((b) => b.responses.some((r) => r.stage === s)),
  );
  const totalSubmissions = buckets.reduce((a, b) => a + b.submissions.length, 0);
  const totalResponses = buckets.reduce((a, b) => a + b.responses.length, 0);

  const inner = Math.max(0, width - PAD.left - PAD.right);
  const slot = n ? inner / n : 0;
  const barWidth = Math.max(2, Math.min(24, slot - 2));
  const maxCount = Math.max(1, ...buckets.map((b) => b.submissions.length));
  // Leave room above the tallest bar for its stacked response dots.
  const stack = Math.min(MAX_DOTS, Math.max(0, ...buckets.map((b) => b.responses.length)));
  const headroom = stack ? stack * 10 + 14 : 0;
  const plotTop = PAD.top + headroom;
  const plotHeight = HEIGHT - plotTop - PAD.bottom;
  const y = (count: number) => plotTop + plotHeight - (count / maxCount) * plotHeight;
  const ticks = maxCount <= 4 ? Array.from({ length: maxCount + 1 }, (_, i) => i) : [0, Math.round(maxCount / 2), maxCount];
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(inner / 72))));
  const selectedIndex = buckets.findIndex(
    (b) => b.day === selectedDay || (b.end && b.day <= selectedDay && selectedDay <= b.end),
  );
  const isSelected = (b: ActivityBucket) => (b.end ? b.day === buckets[selectedIndex]?.day : b.day === selectedDay);
  const tip = hover !== null ? buckets[hover] : null;

  return (
    <Card className="h-full">
      <CardHeader
        as="h3"
        icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
        title={
          <span className="inline-flex items-center gap-1">
            Activity
            <InfoTip label="About the activity chart">
              Bars count applications by the Eastern day they were submitted. Dots mark employer
              emails received that day for applications in this view. Click a bar to show only
              that day’s applications in the table below.
            </InfoTip>
          </span>
        }
        subtitle={`${totalSubmissions} submission${totalSubmissions === 1 ? '' : 's'} · ${totalResponses} employer email${totalResponses === 1 ? '' : 's'} · per ${unit}`}
      />
      <div className="px-4 pb-3 pt-3 sm:px-5">
        {n === 0 ? (
          <EmptyLine>No submissions in this view.</EmptyLine>
        ) : (
          <div ref={ref} className="relative min-w-0">
            {width > 0 && (
              <svg
                width="100%"
                height={HEIGHT}
                viewBox={`0 0 ${width} ${HEIGHT}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Submissions per ${unit}, ${monthDay(buckets[0].day)} to ${monthDay(buckets[n - 1].end ?? buckets[n - 1].day)}`}
                className="block select-none"
                onMouseLeave={() => setHover(null)}
              >
                {ticks.map((t) => (
                  <g key={t}>
                    <line
                      x1={PAD.left}
                      x2={width - PAD.right}
                      y1={y(t)}
                      y2={y(t)}
                      className="stroke-slate-200 dark:stroke-slate-700"
                      strokeWidth={1}
                    />
                    <text
                      x={PAD.left - 6}
                      y={y(t) + 3}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] tabular-nums dark:fill-slate-500"
                    >
                      {t}
                    </text>
                  </g>
                ))}
                {buckets.map((b, i) => {
                  const x = PAD.left + i * slot + (slot - barWidth) / 2;
                  const count = b.submissions.length;
                  const top = y(count);
                  const bottom = y(0);
                  const r = Math.min(4, barWidth / 2, Math.max(0, bottom - top));
                  const selected = isSelected(b);
                  const dim = selectedIndex >= 0 && !selected;
                  const path =
                    count === 0
                      ? ''
                      : `M${x},${bottom} V${top + r} a${r},${r} 0 0 1 ${r},-${r} h${barWidth - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${bottom} Z`;
                  const dots = b.responses.slice(0, MAX_DOTS);
                  const extra = b.responses.length - dots.length;
                  const dotBase = (count === 0 ? bottom : top) - 8;
                  return (
                    <g key={b.day} className={dim ? 'opacity-35' : ''}>
                      {path && (
                        <path
                          d={path}
                          className={`fill-indigo-500 ${hover === i ? 'brightness-110' : ''}`}
                        />
                      )}
                      {dots.map((d, j) => (
                        <circle
                          key={j}
                          cx={x + barWidth / 2}
                          cy={dotBase - j * 10}
                          r={4}
                          strokeWidth={2}
                          className={`${STAGE_FILL[d.stage]} stroke-white dark:stroke-slate-900`}
                        />
                      ))}
                      {extra > 0 && (
                        <text
                          x={x + barWidth / 2}
                          y={dotBase - dots.length * 10 + 2}
                          textAnchor="middle"
                          className="fill-slate-500 text-[9px] dark:fill-slate-400"
                        >
                          +{extra}
                        </text>
                      )}
                      {i % every === 0 && (
                        <text
                          x={x + barWidth / 2}
                          y={HEIGHT - 6}
                          textAnchor="middle"
                          className="fill-slate-400 text-[10px] dark:fill-slate-500"
                        >
                          {monthDay(b.day)}
                        </text>
                      )}
                      <rect
                        x={PAD.left + i * slot}
                        y={PAD.top}
                        width={slot}
                        height={HEIGHT - PAD.top - PAD.bottom}
                        fill="transparent"
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected}
                        aria-label={`${label(b)}: ${count} submission${count === 1 ? '' : 's'}, ${b.responses.length} employer email${b.responses.length === 1 ? '' : 's'}`}
                        className={`cursor-pointer focus:outline-none ${selected ? 'stroke-indigo-500' : 'focus-visible:stroke-indigo-400'}`}
                        strokeWidth={selected ? 1.5 : 1}
                        rx={3}
                        onMouseEnter={() => setHover(i)}
                        onFocus={() => setHover(i)}
                        onBlur={() => setHover(null)}
                        onClick={() => onSelectDay(b.day)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectDay(b.day);
                          }
                        }}
                      />
                    </g>
                  );
                })}
              </svg>
            )}
            {tip && hover !== null && (
              <div
                role="status"
                className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
                style={{
                  top: 0,
                  left: Math.min(Math.max(0, PAD.left + hover * slot + slot / 2 - 70), Math.max(0, width - 150)),
                }}
              >
                <p className="font-semibold text-slate-800 dark:text-slate-100">{label(tip)}</p>
                <p className="tabular-nums text-slate-700 dark:text-slate-200">
                  <strong>{tip.submissions.length}</strong> submitted
                </p>
                {STAGE_ORDER.filter((s) => tip.responses.some((r) => r.stage === s)).map((s) => (
                  <p key={s} className="flex items-center gap-1.5 tabular-nums text-slate-700 dark:text-slate-200">
                    <span className={`h-2 w-2 rounded-full ${STAGE_DOT[s]}`} aria-hidden="true" />
                    <strong>{tip.responses.filter((r) => r.stage === s).length}</strong>{' '}
                    {JOB_EMPLOYER_STAGE_LABELS[s].toLowerCase()}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        {n > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" aria-hidden="true" /> Submissions
            </span>
            {stagesPresent.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${STAGE_DOT[s]}`} aria-hidden="true" />
                {JOB_EMPLOYER_STAGE_LABELS[s]}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
