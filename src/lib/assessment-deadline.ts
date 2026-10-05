export interface AssessmentDeadlineWindow {
  count: number;
  unit: 'business-days' | 'calendar-days' | 'hours';
  timeZone?: string;
}

/** Relative employer deadlines start at the invitation, never at ingestion time. */
export function resolveAssessmentDeadline(receivedAt: string, window: AssessmentDeadlineWindow): string {
  const received = new Date(receivedAt);
  if (!Number.isFinite(received.getTime()) || !Number.isInteger(window.count) || window.count < 1 || window.count > 365) {
    throw new Error('Invalid assessment deadline window');
  }
  if (window.unit === 'hours') return new Date(received.getTime() + window.count * 3600000).toISOString();
  const timeZone = window.timeZone ?? 'America/New_York';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  const origin = parts(received);
  const calendar = new Date(Date.UTC(+origin.year, +origin.month - 1, +origin.day));
  for (let remaining = window.count; remaining > 0;) {
    calendar.setUTCDate(calendar.getUTCDate() + 1);
    if (window.unit === 'calendar-days' || ![0, 6].includes(calendar.getUTCDay())) remaining--;
  }
  // A day-only instruction specifies a due date, not an exact clock time.
  // Store its end of day; notes preserve the original relative window.
  const target = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), calendar.getUTCDate(), 23, 59, 59);
  let instant = target;
  for (let iteration = 0; iteration < 3; iteration++) {
    const p = parts(new Date(instant));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    instant += target - wall;
  }
  return new Date(instant).toISOString();
}
