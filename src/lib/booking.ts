import { isOnSchedule, overlaps, type TimeRange, type WeeklySchedule } from './slots';

export type VisitType = 'video' | 'in-person';

export interface Booking extends TimeRange {
  id: string;
  clinicianId: string;
  patientId: string;
  type: VisitType;
  reason: string;
  status: 'booked' | 'cancelled' | 'completed';
  createdAt: number;
}

export interface BookingRequest extends TimeRange {
  clinicianId: string;
  patientId: string;
  type: VisitType;
  reason: string;
}

export interface ClinicianRules {
  schedule: WeeklySchedule;
  visitMinutes: number;
}

export type BookingError = 'not-found' | 'in-past' | 'too-soon' | 'off-schedule' | 'slot-taken' | 'patient-conflict' | 'reason-required';

export const BOOKING_ERRORS: Record<BookingError, string> = {
  'not-found': 'That visit no longer exists or was already cancelled.',
  'in-past': 'That time has already passed.',
  'too-soon': 'Visits need at least an hour’s notice.',
  'off-schedule': 'That time isn’t in the clinician’s schedule.',
  'slot-taken': 'Someone just booked that slot. Please pick another time.',
  'patient-conflict': 'You already have a visit that overlaps this time.',
  'reason-required': 'Tell the clinician briefly what the visit is about.'
};

export const LEAD_MINUTES = 60;

const active = (b: Booking) => b.status === 'booked';

/**
 * Validates a booking against the clinician's schedule, existing bookings and the
 * patient's own calendar. `ignoreId` lets a reschedule skip the visit being moved.
 */
export function validate(bookings: Booking[], req: BookingRequest, rules: ClinicianRules, now: number, ignoreId?: string): BookingError | null {
  if (!req.reason.trim()) return 'reason-required';
  if (req.start <= now) return 'in-past';
  if (req.start < now + LEAD_MINUTES * 60_000) return 'too-soon';
  if (!isOnSchedule(rules.schedule, rules.visitMinutes, req)) return 'off-schedule';
  const others = bookings.filter((b) => active(b) && b.id !== ignoreId);
  if (others.some((b) => b.clinicianId === req.clinicianId && overlaps(b, req))) return 'slot-taken';
  if (others.some((b) => b.patientId === req.patientId && overlaps(b, req))) return 'patient-conflict';
  return null;
}

let seq = 0;
const newId = (now: number) => `V-${now.toString(36).toUpperCase()}${(seq++).toString(36).toUpperCase()}`;

export type BookingResult = { ok: true; booking: Booking; bookings: Booking[] } | { ok: false; error: BookingError };

export function book(bookings: Booking[], req: BookingRequest, rules: ClinicianRules, now: number): BookingResult {
  const error = validate(bookings, req, rules, now);
  if (error) return { ok: false, error };
  const booking: Booking = { ...req, reason: req.reason.trim(), id: newId(now), status: 'booked', createdAt: now };
  return { ok: true, booking, bookings: [...bookings, booking] };
}

/** Moves a visit atomically: the old slot is only released if the new one is valid. */
export function reschedule(bookings: Booking[], id: string, to: TimeRange, rules: ClinicianRules, now: number): BookingResult {
  const current = bookings.find((b) => b.id === id && active(b));
  if (!current) return { ok: false, error: 'not-found' };
  const req = { ...current, start: to.start, end: to.end };
  const error = validate(bookings, req, rules, now, id);
  if (error) return { ok: false, error };
  const booking = { ...current, start: to.start, end: to.end };
  return { ok: true, booking, bookings: bookings.map((b) => (b.id === id ? booking : b)) };
}

export function cancel(bookings: Booking[], id: string, now: number): Booking[] {
  return bookings.map((b) => (b.id === id && active(b) && b.start > now ? { ...b, status: 'cancelled' } : b));
}

export interface Reminder {
  at: number;
  channel: 'email' | 'sms';
  label: string;
}

/**
 * Reminder plan for a visit: a day-before email and a two-hour text, plus a
 * 10-minute "join now" nudge for video visits. Reminders already in the past
 * when the visit is booked are dropped.
 */
export function reminderPlan(b: Pick<Booking, 'start' | 'type' | 'createdAt'>): Reminder[] {
  const plan: Reminder[] = [
    { at: b.start - 24 * 3600_000, channel: 'email', label: 'Visit details and pre-visit questionnaire' },
    { at: b.start - 2 * 3600_000, channel: 'sms', label: 'Reminder with one-tap confirm or reschedule' }
  ];
  if (b.type === 'video') plan.push({ at: b.start - 10 * 60_000, channel: 'sms', label: 'Link to join the waiting room' });
  return plan.filter((r) => r.at > b.createdAt);
}
