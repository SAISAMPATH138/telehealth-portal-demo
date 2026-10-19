import { CLINICIANS, CLINICS, PATIENT, SPECIALTIES, type Clinician, type Specialty } from '../data/seed';
import { book, BOOKING_ERRORS, reminderPlan, reschedule, type Booking, type VisitType } from '../lib/booking';
import { addDays, generateSlots, sameDayStart, type TimeRange } from '../lib/slots';
import { BOOKING_HORIZON_DAYS, clinicianById, type Store } from '../store';
import { esc, fmtDay, fmtLongDay, fmtTime, fmtWhen, initials, sameDay } from './format';
import { downloadIcs } from './home';

interface Draft {
  specialty?: Specialty;
  clinicianId?: string;
  day?: number;
  slot?: TimeRange;
  type?: VisitType;
  reason: string;
  /** Set when moving an existing visit. */
  rescheduleId?: string;
  error?: string;
  done?: Booking;
}

let draft: Draft = { reason: '' };

const visitTypes = (c: Clinician): VisitType[] => (c.videoOnly ? ['video'] : c.videoVisits ? ['video', 'in-person'] : ['in-person']);

function openSlots(store: Store, c: Clinician, now: number): TimeRange[] {
  const from = new Date(now);
  const mine = store.mine().filter((b) => b.status === 'booked' && b.id !== draft.rescheduleId);
  return generateSlots({ schedule: c.schedule, visitMinutes: c.visitMinutes, from, days: BOOKING_HORIZON_DAYS, busy: store.busyFor(c, from), now })
    // Hide times that clash with the patient's own visits elsewhere.
    .filter((s) => !mine.some((b) => b.start < s.end && s.start < b.end));
}

function steps(current: number): string {
  const labels = ['Specialty', 'Clinician', 'Time', 'Details'];
  return `<ol class="steps">${labels.map((l, i) => `<li ${i === current ? 'aria-current="step"' : ''} class="${i < current ? 'done' : ''}">${l}</li>`).join('')}</ol>`;
}

export function startReschedule(store: Store, id: string) {
  const b = store.bookings().find((x) => x.id === id && x.status === 'booked');
  if (!b) return;
  const c = clinicianById(b.clinicianId);
  draft = { specialty: c.specialty, clinicianId: c.id, type: b.type, reason: b.reason, rescheduleId: id };
}

export function resetDraft() {
  draft = { reason: '' };
}

export function renderBook(app: HTMLElement, store: Store, navigate: (h: string) => void) {
  const now = Date.now();
  const render = () => renderBook(app, store, navigate);
  const moving = draft.rescheduleId ? store.bookings().find((b) => b.id === draft.rescheduleId) : undefined;
  const title = moving ? 'Reschedule visit' : 'Book a visit';

  if (draft.done) {
    const b = draft.done;
    const c = clinicianById(b.clinicianId);
    app.innerHTML = `<div class="panel narrow done">
      <div class="tick" aria-hidden="true">✓</div>
      <h1>${draft.rescheduleId ? 'Visit moved' : 'You’re booked'}</h1>
      <p><strong>${fmtLongDay(b.start)}, ${fmtTime(b.start)}</strong> with ${esc(c.name)} · ${b.type === 'video' ? 'Video visit' : 'In person'}</p>
      <h2>We’ll remind you</h2>
      <ul class="reminders">${reminderPlan(b)
        .map((r) => `<li><span class="channel">${r.channel === 'sms' ? 'SMS' : 'Email'}</span><div><strong>${fmtWhen(r.at)}</strong><p class="muted small">${r.label}</p></div></li>`)
        .join('') || '<li class="muted small">This visit is soon, so no reminders are needed.</li>'}</ul>
      <div class="row-actions"><button type="button" class="btn" data-ics>Add to calendar</button><a class="btn btn-primary" href="#/home">Back to home</a></div>
    </div>`;
    app.querySelector('[data-ics]')!.addEventListener('click', () => downloadIcs(store, b.id));
    resetDraft();
    return;
  }

  // Step 1: specialty
  if (!draft.specialty) {
    app.innerHTML = `<header class="page-head"><h1>${title}</h1>${steps(0)}</header>
      <div class="choice-grid">${SPECIALTIES.map(
        (s) => `<button type="button" class="choice" data-specialty="${s.id}"><span class="emoji" aria-hidden="true">${s.icon}</span><strong>${s.id}</strong><span class="muted small">${s.blurb}</span></button>`
      ).join('')}</div>`;
    app.querySelectorAll<HTMLButtonElement>('[data-specialty]').forEach((b) =>
      b.addEventListener('click', () => {
        draft.specialty = b.dataset.specialty as Specialty;
        render();
      })
    );
    return;
  }

  // Step 2: clinician
  if (!draft.clinicianId) {
    const options = CLINICIANS.filter((c) => c.specialty === draft.specialty).map((c) => ({ c, next: openSlots(store, c, now)[0] }));
    app.innerHTML = `<header class="page-head"><h1>${title}</h1>${steps(1)}</header>
      <button type="button" class="link back" data-back>← ${esc(draft.specialty)}</button>
      <div class="clinicians">${options
        .map(({ c, next }) => {
          const clinic = CLINICS.find((x) => x.id === c.clinicId)!;
          return `<button type="button" class="clinician" data-clinician="${c.id}" ${next ? '' : 'disabled'}>
            <div class="avatar" aria-hidden="true">${initials(c.name)}</div>
            <div><strong>${esc(c.name)}</strong><p class="muted small">${esc(clinic.name)} · ${c.visitMinutes}-min visits · ${c.languages.join(', ')}</p><p class="small">${esc(c.bio)}</p>
            <p class="small tags">${visitTypes(c).map((t) => `<span class="pill">${t === 'video' ? '📹 Video' : '🏥 In person'}</span>`).join(' ')}</p></div>
            <div class="next"><span class="muted small">Next available</span><strong>${next ? fmtWhen(next.start) : 'None in 3 weeks'}</strong></div>
          </button>`;
        })
        .join('')}</div>`;
    app.querySelector('[data-back]')!.addEventListener('click', () => {
      draft.specialty = undefined;
      render();
    });
    app.querySelectorAll<HTMLButtonElement>('[data-clinician]').forEach((b) =>
      b.addEventListener('click', () => {
        draft.clinicianId = b.dataset.clinician;
        render();
      })
    );
    return;
  }

  const c = clinicianById(draft.clinicianId);
  const slots = openSlots(store, c, now);

  // Step 3: day and time
  if (!draft.slot) {
    const days = Array.from({ length: 14 }, (_, i) => sameDayStart(addDays(new Date(now), i)));
    const counts = days.map((d) => slots.filter((s) => sameDay(s.start, d)).length);
    if (draft.day === undefined || !counts[days.findIndex((d) => d === draft.day)]) {
      const firstOpen = counts.findIndex((n) => n > 0);
      draft.day = firstOpen >= 0 ? days[firstOpen] : days[0];
    }
    const daySlots = slots.filter((s) => sameDay(s.start, draft.day!));
    const groups: [string, TimeRange[]][] = [
      ['Morning', daySlots.filter((s) => new Date(s.start).getHours() < 12)],
      ['Afternoon', daySlots.filter((s) => new Date(s.start).getHours() >= 12 && new Date(s.start).getHours() < 17)],
      ['Evening', daySlots.filter((s) => new Date(s.start).getHours() >= 17)]
    ];
    app.innerHTML = `<header class="page-head"><h1>${title}</h1>${steps(2)}</header>
      ${draft.error ? `<p class="error" role="alert">${esc(draft.error)}</p>` : ''}
      ${moving ? `<p class="notice">Moving your visit on <strong>${fmtWhen(moving.start)}</strong>. It stays booked until you confirm a new time.</p>` : `<button type="button" class="link back" data-back>← ${esc(c.specialty)}</button>`}
      <div class="panel">
        <div class="who"><div class="avatar" aria-hidden="true">${initials(c.name)}</div><div><strong>${esc(c.name)}</strong><p class="muted small">${c.visitMinutes}-minute visits</p></div></div>
        <div class="days" role="listbox" aria-label="Choose a day">${days
          .map(
            (d, i) => `<button type="button" role="option" data-day="${d}" aria-selected="${d === draft.day}" ${counts[i] ? '' : 'disabled'}>
              <span>${fmtDay(d).split(',')[0]}</span><strong>${new Date(d).getDate()}</strong><small>${counts[i] ? `${counts[i]} open` : '—'}</small></button>`
          )
          .join('')}</div>
        ${daySlots.length
          ? groups
              .filter(([, g]) => g.length)
              .map(([label, g]) => `<h3 class="slot-label">${label}</h3><div class="slots">${g.map((s) => `<button type="button" data-slot="${s.start}">${fmtTime(s.start)}</button>`).join('')}</div>`)
              .join('')
          : '<p class="muted">No open times in the next two weeks.</p>'}
      </div>`;
    app.querySelector('[data-back]')?.addEventListener('click', () => {
      draft.clinicianId = undefined;
      render();
    });
    app.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((b) =>
      b.addEventListener('click', () => {
        draft.day = Number(b.dataset.day);
        render();
      })
    );
    app.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        const start = Number(b.dataset.slot);
        draft.slot = { start, end: start + c.visitMinutes * 60_000 };
        draft.error = undefined;
        render();
      })
    );
    return;
  }

  // Step 4: details and confirm
  const types = visitTypes(c);
  if (!draft.type || !types.includes(draft.type)) draft.type = types[0];
  app.innerHTML = `<header class="page-head"><h1>${title}</h1>${steps(3)}</header>
    <button type="button" class="link back" data-back>← Change time</button>
    <form class="panel narrow" id="confirm" novalidate>
      <div class="who"><div class="avatar" aria-hidden="true">${initials(c.name)}</div><div><strong>${esc(c.name)}</strong><p class="muted small">${fmtLongDay(draft.slot.start)} · ${fmtTime(draft.slot.start)} – ${fmtTime(draft.slot.end)}</p></div></div>
      <fieldset class="types"><legend>Visit type</legend>${types
        .map((t) => `<label><input type="radio" name="type" value="${t}" ${draft.type === t ? 'checked' : ''}><span>${t === 'video' ? '📹 Video visit' : `🏥 In person at ${esc(CLINICS.find((x) => x.id === c.clinicId)!.name)}`}</span></label>`)
        .join('')}</fieldset>
      ${moving ? '' : `<label class="field"><span>What’s the visit about?</span><textarea name="reason" rows="3" maxlength="240" placeholder="e.g. Follow-up on blood pressure readings" ${draft.error === BOOKING_ERRORS['reason-required'] ? 'aria-invalid="true"' : ''}>${esc(draft.reason)}</textarea></label>`}
      <p class="muted small">Booking for ${esc(PATIENT.name)}. This demo stores bookings only in your browser.</p>
      ${draft.error ? `<p class="error" role="alert">${esc(draft.error)}</p>` : ''}
      <button class="btn btn-primary btn-block" type="submit">${moving ? 'Confirm new time' : 'Confirm booking'}</button>
    </form>`;
  app.querySelector('[data-back]')!.addEventListener('click', () => {
    draft.slot = undefined;
    render();
  });
  const form = app.querySelector<HTMLFormElement>('#confirm')!;
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'type') draft.type = t.value as VisitType;
  });
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.name === 'reason') draft.reason = t.value;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const rules = { schedule: c.schedule, visitMinutes: c.visitMinutes };
    // Other patients' bookings count too, so validate against the full picture.
    const all = [...store.bookings(), ...store.othersFor(c, new Date(now))];
    const result = draft.rescheduleId
      ? reschedule(all, draft.rescheduleId, draft.slot!, rules, Date.now())
      : book(all, { clinicianId: c.id, patientId: PATIENT.id, type: draft.type!, reason: draft.reason, ...draft.slot! }, rules, Date.now());
    if (!result.ok) {
      draft.error = BOOKING_ERRORS[result.error];
      if (result.error === 'slot-taken' || result.error === 'too-soon') draft.slot = undefined;
      return render();
    }
    const updated = draft.rescheduleId
      ? store.bookings().map((b) => (b.id === draft.rescheduleId ? { ...result.booking, type: draft.type! } : b))
      : [...store.bookings(), result.booking];
    store.setBookings(updated);
    draft.done = updated.find((b) => b.id === result.booking.id);
    render();
  });
}

export const navigateBook = (store: Store, params: URLSearchParams) => {
  const id = params.get('reschedule');
  if (id) startReschedule(store, id);
};
