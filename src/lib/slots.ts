/** Weekly opening hours: weekday (0 = Sunday) → [startMinute, endMinute] windows in local time. */
export type WeeklySchedule = Partial<Record<number, [number, number][]>>;

export interface TimeRange {
  start: number; // epoch ms
  end: number;
}

export interface SlotOptions {
  schedule: WeeklySchedule;
  visitMinutes: number;
  /** First calendar day to consider (any time on that day). */
  from: Date;
  days: number;
  /** Ranges the clinician is already booked for. */
  busy: TimeRange[];
  now: number;
  /** Minimum notice before a visit can be booked. */
  leadMinutes?: number;
}

export const overlaps = (a: TimeRange, b: TimeRange) => a.start < b.end && b.start < a.end;

/** Local midnight for the given date, plus `minutes`. Built via the Date constructor so DST is handled. */
export function atMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
}

/** Epoch ms of local midnight on the given date. */
export const sameDayStart = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();

export function addDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

/** Open, bookable slots for a clinician over a run of days. */
export function generateSlots({ schedule, visitMinutes, from, days, busy, now, leadMinutes = 60 }: SlotOptions): TimeRange[] {
  const earliest = now + leadMinutes * 60_000;
  const slots: TimeRange[] = [];
  for (let d = 0; d < days; d++) {
    const day = addDays(from, d);
    for (const [open, close] of schedule[day.getDay()] ?? []) {
      for (let m = open; m + visitMinutes <= close; m += visitMinutes) {
        const slot = { start: atMinutes(day, m).getTime(), end: atMinutes(day, m + visitMinutes).getTime() };
        if (slot.start < earliest) continue;
        if (busy.some((b) => overlaps(b, slot))) continue;
        slots.push(slot);
      }
    }
  }
  return slots;
}

/** Whether `range` lines up exactly with a slot boundary in the clinician's schedule. */
export function isOnSchedule(schedule: WeeklySchedule, visitMinutes: number, range: TimeRange): boolean {
  const start = new Date(range.start);
  const startMinute = start.getHours() * 60 + start.getMinutes();
  if (range.end - range.start !== visitMinutes * 60_000) return false;
  return (schedule[start.getDay()] ?? []).some(
    ([open, close]) => startMinute >= open && startMinute + visitMinutes <= close && (startMinute - open) % visitMinutes === 0
  );
}
