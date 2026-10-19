export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', opts);
const dayFmt = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const longDayFmt = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit' });
const isoDayFmt = fmt({ year: 'numeric', month: 'short', day: 'numeric' });

export const fmtDay = (t: number) => dayFmt.format(t);
export const fmtLongDay = (t: number) => longDayFmt.format(t);
export const fmtTime = (t: number) => timeFmt.format(t);
export const fmtWhen = (t: number) => `${fmtDay(t)} · ${fmtTime(t)}`;
/** ISO yyyy-mm-dd → "Feb 11, 2026" without a timezone shift. */
export function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDayFmt.format(new Date(y, m - 1, d));
}

export function fmtRelative(t: number, now: number): string {
  const mins = Math.round((t - now) / 60_000);
  if (mins <= 0 && mins > -60) return 'now';
  if (mins < 0) return 'earlier';
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export const initials = (name: string) =>
  name
    .replace(/^(Dr\.|Mr\.|Ms\.)\s+/, '')
    .split(/[\s,]+/)
    .filter((p) => /^[A-Z]/.test(p))
    .slice(0, 2)
    .map((p) => p[0])
    .join('');

export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** Builds an .ics calendar file for a visit, offered as a download. */
export function icsFor(v: { id: string; start: number; end: number; title: string; location: string; details: string }): string {
  const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const line = (s: string) => s.replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bridge Harbour//Telehealth Demo//EN', 'BEGIN:VEVENT',
    `UID:${v.id}@telehealth-demo`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(v.start)}`, `DTEND:${stamp(v.end)}`,
    `SUMMARY:${line(v.title)}`, `LOCATION:${line(v.location)}`, `DESCRIPTION:${line(v.details)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Visit reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}
