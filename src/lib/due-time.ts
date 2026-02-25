const DUE_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDueTimeString(value: string): boolean {
  return DUE_TIME_REGEX.test(value);
}

export function validateDueTimeRange(
  dueTimeStart: string | undefined,
  dueTimeEnd: string | undefined
): { valid: true } | { valid: false; error: string } {
  if (!dueTimeStart && !dueTimeEnd) {
    return { valid: true };
  }

  if (!dueTimeStart && dueTimeEnd) {
    return { valid: false, error: 'dueTimeEnd requires dueTimeStart' };
  }

  if (dueTimeStart && !isDueTimeString(dueTimeStart)) {
    return { valid: false, error: 'dueTimeStart must be in HH:mm format' };
  }

  if (dueTimeEnd && !isDueTimeString(dueTimeEnd)) {
    return { valid: false, error: 'dueTimeEnd must be in HH:mm format' };
  }

  if (dueTimeStart && dueTimeEnd && dueTimeStart >= dueTimeEnd) {
    return { valid: false, error: 'dueTimeEnd must be after dueTimeStart' };
  }

  return { valid: true };
}

export function compareDueTimes(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

export function formatDueTimeForDisplay(value: string): string {
  const [hours, minutes] = value.split(':');
  return `${Number(hours)}:${minutes}`;
}

export function formatDueTimeRangeForDisplay(dueTimeStart?: string, dueTimeEnd?: string): string | null {
  if (!dueTimeStart) return null;
  const start = formatDueTimeForDisplay(dueTimeStart);
  if (!dueTimeEnd) return start;
  return `${start}-${formatDueTimeForDisplay(dueTimeEnd)}`;
}
