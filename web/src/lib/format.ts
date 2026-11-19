/** Times are stored in UTC and shown in Indian time (docs/api.md#conventions). */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** With the year, for signatures and records that must read unambiguously. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Indian time, as `YYYY-MM-DD` (the form dates travel in). */
export const todayIst = (): string => DAY_FORMAT.format(new Date());

/**
 * A calendar day (`YYYY-MM-DD`, already in Indian time) in Indian style: "27 Nov", with the year
 * when it is not this year.
 */
export function formatDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  const sameYear = year === Number(todayIst().slice(0, 4));
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(!sameYear && { year: 'numeric' }),
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

const RELATIVE = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

/** "5 minutes ago", "yesterday"; older than a week, the date. */
export function formatRelative(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return RELATIVE.format(0, 'minute');
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return RELATIVE.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return RELATIVE.format(Math.round(seconds / 86_400), 'day');
  return formatTime(iso);
}

/** The start of a SHA-256 hash, enough to recognise it. */
export const shortHash = (hash: string) => `${hash.slice(0, 12)}…`;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
