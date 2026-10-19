import { describe, expect, it } from 'vitest';
import { CLINICIANS, otherPatientsBusy, SOURCE_RECORDS } from '../data/seed';
import { book, cancel, reminderPlan, reschedule, validate, type Booking, type BookingRequest } from './booking';
import { mergeRecords } from './records';
import { addDays, atMinutes, generateSlots, isOnSchedule, type WeeklySchedule } from './slots';

// Monday 2026-10-19, 07:00 local.
const MONDAY = new Date(2026, 9, 19);
const NOW = atMinutes(MONDAY, 7 * 60).getTime();
const schedule: WeeklySchedule = { 1: [[9 * 60, 12 * 60]], 2: [[9 * 60, 10 * 60]] };
const rules = { schedule, visitMinutes: 30 };
const at = (dayOffset: number, hour: number, minute = 0) => atMinutes(addDays(MONDAY, dayOffset), hour * 60 + minute).getTime();
const req = (start: number, extra: Partial<BookingRequest> = {}): BookingRequest => ({
  clinicianId: 'c1',
  patientId: 'p1',
  type: 'video',
  reason: 'Follow-up',
  start,
  end: start + 30 * 60_000,
  ...extra
});
const minutesOfDay = (t: number) => new Date(t).getHours() * 60 + new Date(t).getMinutes();

describe('generateSlots', () => {
  it('cuts schedule windows into visit-length slots', () => {
    const slots = generateSlots({ schedule, visitMinutes: 30, from: MONDAY, days: 2, busy: [], now: NOW });
    expect(slots).toHaveLength(6 + 2);
    expect(new Date(slots[0].start).getHours()).toBe(9);
    expect(slots.every((s) => s.end - s.start === 30 * 60_000)).toBe(true);
  });

  it('skips busy slots, slots inside the notice period, and days without hours', () => {
    const busy = [{ start: at(0, 10), end: at(0, 10, 30) }];
    const slots = generateSlots({ schedule, visitMinutes: 30, from: MONDAY, days: 7, busy, now: at(0, 9, 15), leadMinutes: 60 });
    const monday = slots.filter((s) => new Date(s.start).getDay() === 1).map((s) => minutesOfDay(s.start));
    expect(monday).toEqual([10 * 60 + 30, 11 * 60, 11 * 60 + 30]);
    expect(slots.filter((s) => [0, 3, 4, 5, 6].includes(new Date(s.start).getDay()))).toHaveLength(0);
  });

  it('only accepts times on a slot boundary', () => {
    expect(isOnSchedule(schedule, 30, { start: at(0, 9, 30), end: at(0, 10) })).toBe(true);
    expect(isOnSchedule(schedule, 30, { start: at(0, 9, 10), end: at(0, 9, 40) })).toBe(false);
    expect(isOnSchedule(schedule, 30, { start: at(0, 11, 45), end: at(0, 12, 15) })).toBe(false);
    expect(isOnSchedule(schedule, 30, { start: at(3, 9), end: at(3, 9, 30) })).toBe(false);
  });
});

describe('booking', () => {
  it('books a free slot and rejects a second booking of the same slot', () => {
    const first = book([], req(at(0, 9)), rules, NOW);
    expect(first.ok).toBe(true);
    const bookings = first.ok ? first.bookings : [];
    expect(book(bookings, req(at(0, 9), { patientId: 'p2' }), rules, NOW)).toEqual({ ok: false, error: 'slot-taken' });
  });

  it('stops a patient double-booking across clinicians', () => {
    const first = book([], req(at(0, 9)), rules, NOW);
    const bookings = first.ok ? first.bookings : [];
    expect(validate(bookings, req(at(0, 9), { clinicianId: 'c2' }), rules, NOW)).toBe('patient-conflict');
  });

  it('enforces notice, schedule and a reason', () => {
    expect(validate([], req(at(0, 6)), rules, NOW)).toBe('in-past');
    expect(validate([], req(at(0, 9)), rules, at(0, 8, 30))).toBe('too-soon');
    expect(validate([], req(at(0, 13)), rules, NOW)).toBe('off-schedule');
    expect(validate([], req(at(0, 9), { reason: '  ' }), rules, NOW)).toBe('reason-required');
  });

  it('reschedules atomically and keeps the original if the new slot is taken', () => {
    let bookings: Booking[] = [];
    const a = book(bookings, req(at(0, 9)), rules, NOW);
    bookings = a.ok ? a.bookings : bookings;
    const b = book(bookings, req(at(0, 10), { patientId: 'p2' }), rules, NOW);
    bookings = b.ok ? b.bookings : bookings;
    const id = a.ok ? a.booking.id : '';

    expect(reschedule(bookings, id, { start: at(0, 10), end: at(0, 10, 30) }, rules, NOW)).toEqual({ ok: false, error: 'slot-taken' });
    const moved = reschedule(bookings, id, { start: at(0, 11), end: at(0, 11, 30) }, rules, NOW);
    expect(moved.ok && moved.booking.start).toBe(at(0, 11));
    expect(moved.ok && moved.bookings.filter((x) => x.patientId === 'p1')).toHaveLength(1);
    expect(reschedule(bookings, 'nope', { start: at(0, 11), end: at(0, 11, 30) }, rules, NOW)).toEqual({ ok: false, error: 'not-found' });
  });

  it('cancels future visits only, freeing the slot', () => {
    const a = book([], req(at(0, 9)), rules, NOW);
    const bookings = a.ok ? a.bookings : [];
    const cancelled = cancel(bookings, bookings[0].id, NOW);
    expect(cancelled[0].status).toBe('cancelled');
    expect(validate(cancelled, req(at(0, 9), { patientId: 'p2' }), rules, NOW)).toBeNull();
    expect(cancel(bookings, bookings[0].id, at(0, 10))[0].status).toBe('booked');
  });

  it('plans reminders and drops ones already in the past', () => {
    const far = reminderPlan({ start: at(2, 9), type: 'video', createdAt: NOW });
    expect(far.map((r) => r.channel)).toEqual(['email', 'sms', 'sms']);
    const soon = reminderPlan({ start: at(0, 10), type: 'in-person', createdAt: NOW });
    expect(soon).toHaveLength(1);
    expect(soon[0].at).toBe(at(0, 8));
  });
});

describe('seed data', () => {
  it('leaves every clinician with some open slots over two weeks', () => {
    for (const c of CLINICIANS) {
      const busy = otherPatientsBusy(c, MONDAY, 14);
      const open = generateSlots({ schedule: c.schedule, visitMinutes: c.visitMinutes, from: MONDAY, days: 14, busy, now: NOW });
      expect(open.length, c.name).toBeGreaterThan(3);
    }
  });
});

describe('mergeRecords', () => {
  const merged = mergeRecords(SOURCE_RECORDS);

  it('de-duplicates by code and keeps every source', () => {
    const lisinopril = merged.medications.find((m) => m.value.name === 'Lisinopril')!;
    expect(lisinopril.sources).toEqual(['Harbourview', 'Northgate']);
    expect(lisinopril.conflict).toBeUndefined();
    expect(merged.medications.filter((m) => m.value.code === '314076')).toHaveLength(1);
  });

  it('flags a dose that differs between clinics and shows the latest', () => {
    const statin = merged.medications.find((m) => m.value.name === 'Atorvastatin')!;
    expect(statin.value.dose).toBe('40 mg');
    expect(statin.conflict).toMatch(/20 mg.*40 mg/);
  });

  it('flags a medication stopped in one system but active in another', () => {
    const ibuprofen = merged.medications.find((m) => m.value.name === 'Ibuprofen')!;
    expect(ibuprofen.value.status).toBe('stopped');
    expect(ibuprofen.conflict).toMatch(/still active at Harbourview/);
  });

  it('keeps the most severe allergy and every reaction', () => {
    const pen = merged.allergies.find((a) => a.value.substance === 'Penicillin')!;
    expect(pen.value.severity).toBe('severe');
    expect(pen.value.reaction).toBe('Hives; Rash; Swelling of lips');
    expect(merged.allergies[0].value.substance).toBe('Penicillin');
  });

  it('merges conditions, keeping the earliest onset', () => {
    const back = merged.conditions.find((c) => c.value.code === 'M54.5')!;
    expect(back.value.onset).toBe('2025-08-30');
    expect(back.conflict).toBeDefined();
  });

  it('dedupes shared lab results and immunizations, and flags out-of-range labs', () => {
    const a1c = merged.labs.find((l) => l.latest.code === '4548-4')!;
    expect(a1c.history).toHaveLength(1);
    expect(a1c.sources).toEqual(['Harbourview', 'Northgate']);
    const chol = merged.labs.find((l) => l.latest.code === '2093-3')!;
    expect(chol.latest.value).toBe(196);
    expect(chol.flag).toBeNull();
    expect(merged.labs.find((l) => l.latest.code === '13457-7')!.flag).toBe('high');
    expect(merged.immunizations.filter((i) => i.value.code === '141')).toHaveLength(1);
  });

  it('orders encounters newest first and counts conflicts', () => {
    const dates = merged.encounters.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(merged.conflicts).toBe(4);
  });
});
