import { CLINICIANS, otherPatientsBusy, PATIENT, type Clinician } from './data/seed';
import type { Booking } from './lib/booking';
import { addDays, generateSlots, type TimeRange } from './lib/slots';

const KEY = 'telehealth-demo-state-v1';
export const BOOKING_HORIZON_DAYS = 21;

interface State {
  bookings: Booking[];
}

export const clinicianById = (id: string) => CLINICIANS.find((c) => c.id === id)!;

/**
 * First-visit state: a video visit starting in about 10 minutes (so the waiting
 * room can be tried straight away) and a cardiology follow-up in ~10 days.
 */
function seedState(now: number): State {
  const soon = Math.ceil((now + 10 * 60_000) / (5 * 60_000)) * 5 * 60_000;
  const cardio = clinicianById('c6');
  const followUp = generateSlots({
    schedule: cardio.schedule,
    visitMinutes: cardio.visitMinutes,
    from: addDays(new Date(now), 9),
    days: 14,
    busy: otherPatientsBusy(cardio, addDays(new Date(now), 9), 14),
    now
  })[0];
  const createdAt = now - 6 * 86_400_000;
  const bookings: Booking[] = [
    { id: 'V-DEMO1', clinicianId: 'c4', patientId: PATIENT.id, type: 'video', reason: 'Weekly therapy session', start: soon, end: soon + 45 * 60_000, status: 'booked', createdAt }
  ];
  if (followUp) {
    bookings.push({ id: 'V-DEMO2', clinicianId: 'c6', patientId: PATIENT.id, type: 'in-person', reason: 'Lipid recheck after statin dose change', ...followUp, status: 'booked', createdAt });
  }
  return { bookings };
}

function load(now: number): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (Array.isArray(parsed.bookings)) return parsed;
    }
  } catch {
    /* storage blocked or corrupt */
  }
  return seedState(now);
}

export function createStore() {
  let state = load(Date.now());
  const listeners = new Set<() => void>();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* the demo still works for this session */
    }
    for (const fn of listeners) fn();
  }

  return {
    bookings: () => state.bookings,
    setBookings(next: Booking[]) {
      state = { ...state, bookings: next };
      save();
    },
    mine: () => state.bookings.filter((b) => b.patientId === PATIENT.id),
    /** Bookings held by other (fictional) patients, shaped like real bookings for validation. */
    othersFor(c: Clinician, from: Date): Booking[] {
      return otherPatientsBusy(c, from, BOOKING_HORIZON_DAYS).map((r, i) => ({
        ...r, id: `other-${c.id}-${i}`, clinicianId: c.id, patientId: 'other', type: 'video', reason: '', status: 'booked', createdAt: 0
      }));
    },
    /** Times a clinician can't take: other (fictional) patients plus stored bookings. */
    busyFor(c: Clinician, from: Date): TimeRange[] {
      const stored = state.bookings.filter((b) => b.clinicianId === c.id && b.status === 'booked');
      return [...otherPatientsBusy(c, from, BOOKING_HORIZON_DAYS), ...stored];
    },
    reset() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      state = seedState(Date.now());
      save();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
    }
  };
}

export type Store = ReturnType<typeof createStore>;
