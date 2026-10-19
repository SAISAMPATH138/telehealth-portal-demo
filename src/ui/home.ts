import { CLINICS, PATIENT, SOURCE_RECORDS } from '../data/seed';
import { cancel, reminderPlan, type Booking } from '../lib/booking';
import { mergeRecords } from '../lib/records';
import { clinicianById, type Store } from '../store';
import { esc, fmtIsoDate, fmtLongDay, fmtRelative, fmtTime, fmtWhen, icsFor, initials } from './format';

export const JOIN_WINDOW_MS = 15 * 60_000;
const record = mergeRecords(SOURCE_RECORDS);

export const canJoin = (b: Booking, now: number) => b.type === 'video' && b.status === 'booked' && now >= b.start - JOIN_WINDOW_MS && now < b.end;

function visitCard(b: Booking, now: number, primary = false): string {
  const c = clinicianById(b.clinicianId);
  const clinic = CLINICS.find((x) => x.id === c.clinicId)!;
  const joinable = canJoin(b, now);
  const action =
    b.type === 'video'
      ? joinable
        ? `<a class="btn btn-primary" href="#/room/${b.id}">Join waiting room</a>`
        : `<span class="muted small">Waiting room opens at ${fmtTime(b.start - JOIN_WINDOW_MS)}</span> <a class="link small" href="#/room/${b.id}">Preview it</a>`
      : `<span class="muted small">${esc(clinic.name)}</span>`;
  return `<article class="visit ${primary ? 'visit-primary' : ''}">
    <div class="avatar" aria-hidden="true">${initials(c.name)}</div>
    <div class="visit-main">
      <p class="visit-when">${primary ? fmtLongDay(b.start) : fmtWhen(b.start)} <span class="pill">${fmtRelative(b.start, now)}</span></p>
      ${primary ? `<p class="visit-time">${fmtTime(b.start)} – ${fmtTime(b.end)}</p>` : ''}
      <h3>${esc(c.name)} <span class="muted">· ${c.specialty}</span></h3>
      <p class="muted">${b.type === 'video' ? '📹 Video visit' : '🏥 In person'} · ${esc(b.reason)}</p>
      <div class="visit-actions">
        ${action}
        <a class="link small" href="#/book?reschedule=${b.id}">Reschedule</a>
        <button type="button" class="link small" data-cancel="${b.id}">Cancel</button>
        <button type="button" class="link small" data-ics="${b.id}">Add to calendar</button>
      </div>
    </div>
  </article>`;
}

export function renderHome(app: HTMLElement, store: Store) {
  const now = Date.now();
  const upcoming = store
    .mine()
    .filter((b) => b.status === 'booked' && b.end > now)
    .sort((a, b) => a.start - b.start);
  const [next, ...rest] = upcoming;
  const reminders = upcoming
    .flatMap((b) => reminderPlan(b).map((r) => ({ ...r, booking: b })))
    .filter((r) => r.at > now)
    .sort((a, b) => a.at - b.at)
    .slice(0, 4);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const severe = record.allergies.filter((a) => a.value.severity === 'severe');
  const activeMeds = record.medications.filter((m) => m.value.status === 'active');

  app.innerHTML = `<header class="page-head">
      <h1>${greeting}, ${PATIENT.name.split(' ')[0]}</h1>
      <p class="muted">${upcoming.length ? `You have ${upcoming.length} upcoming visit${upcoming.length === 1 ? '' : 's'}.` : 'No upcoming visits.'}</p>
    </header>
    <div class="home-grid">
      <section class="panel span-2" aria-label="Next visit">
        <div class="panel-head"><h2>Next visit</h2><a class="btn" href="#/book">Book a visit</a></div>
        ${next ? visitCard(next, now, true) : '<p class="empty">Nothing booked. <a href="#/book">Find a time</a> that works for you.</p>'}
        ${rest.length ? `<h2 class="sub">Later</h2>${rest.map((b) => visitCard(b, now)).join('')}` : ''}
      </section>
      <section class="panel" aria-label="Reminders">
        <div class="panel-head"><h2>Scheduled reminders</h2></div>
        ${reminders.length
          ? `<ul class="reminders">${reminders
              .map((r) => `<li><span class="channel">${r.channel === 'sms' ? 'SMS' : 'Email'}</span><div><strong>${fmtWhen(r.at)}</strong><p class="muted small">${r.label}</p></div></li>`)
              .join('')}</ul>`
          : '<p class="muted small">Reminders appear here once you book a visit.</p>'}
        <p class="muted small note">Every visit gets a day-before email, a two-hour text and, for video visits, a join link 10 minutes before. Automated reminders are one of the most reliable ways to reduce no-shows.</p>
      </section>
      <section class="panel" aria-label="Health summary">
        <div class="panel-head"><h2>Health summary</h2><a class="link small" href="#/records">Full record</a></div>
        ${record.conflicts ? `<a class="review" href="#/records"><strong>${record.conflicts} items need review</strong><span>Your clinics' records disagree. Your care team will reconcile them at your next visit.</span></a>` : ''}
        <dl class="facts">
          <div><dt>Active medications</dt><dd>${activeMeds.length}</dd></div>
          <div><dt>Allergies</dt><dd>${record.allergies.length}${severe.length ? ` <span class="sev sev-severe">${severe.length} severe</span>` : ''}</dd></div>
          <div><dt>Last visit</dt><dd>${fmtIsoDate(record.encounters[0].date)}</dd></div>
          <div><dt>Connected clinics</dt><dd>${CLINICS.length}</dd></div>
        </dl>
      </section>
    </div>`;

  app.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.cancel!;
      const card = btn.closest('.visit-actions')!;
      if (card.querySelector('.confirm-cancel')) return;
      card.insertAdjacentHTML('beforeend', `<span class="confirm-cancel">Cancel this visit? <button type="button" class="btn btn-danger btn-sm" data-yes>Yes, cancel</button> <button type="button" class="link small" data-no>Keep it</button></span>`);
      card.querySelector('[data-yes]')!.addEventListener('click', () => store.setBookings(cancel(store.bookings(), id, Date.now())));
      card.querySelector('[data-no]')!.addEventListener('click', () => card.querySelector('.confirm-cancel')!.remove());
    })
  );
  app.querySelectorAll<HTMLButtonElement>('[data-ics]').forEach((btn) => btn.addEventListener('click', () => downloadIcs(store, btn.dataset.ics!)));
}

export function downloadIcs(store: Store, id: string) {
  const b = store.bookings().find((x) => x.id === id);
  if (!b) return;
  const c = clinicianById(b.clinicianId);
  const clinic = CLINICS.find((x) => x.id === c.clinicId)!;
  const blob = new Blob(
    [icsFor({ id: b.id, start: b.start, end: b.end, title: `${b.type === 'video' ? 'Video visit' : 'Visit'} with ${c.name}`, location: b.type === 'video' ? 'Online (patient portal waiting room)' : clinic.name, details: b.reason })],
    { type: 'text/calendar' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `visit-${b.id}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function renderVisits(app: HTMLElement, store: Store) {
  const now = Date.now();
  const mine = store.mine().sort((a, b) => b.start - a.start);
  const past = mine.filter((b) => b.status !== 'booked' || b.end <= now);
  app.innerHTML = `<header class="page-head"><h1>Visits</h1><p class="muted">Portal bookings plus visit notes from every connected clinic.</p></header>
    <div class="panel">
      ${past.length ? `<h2>Booked through the portal</h2><ul class="timeline">${past
        .map((b) => {
          const c = clinicianById(b.clinicianId);
          const label = b.status === 'cancelled' ? 'Cancelled' : 'Completed';
          return `<li><time>${fmtWhen(b.start)}</time><div><strong>${esc(c.name)}</strong> <span class="pill ${b.status === 'cancelled' ? 'pill-muted' : ''}">${label}</span><p class="muted small">${b.type === 'video' ? 'Video visit' : 'In person'} · ${esc(b.reason)}</p></div></li>`;
        })
        .join('')}</ul>` : ''}
      <h2>Visit history</h2>
      <ul class="timeline">${record.encounters
        .map((e) => `<li><time>${fmtIsoDate(e.date)}</time><div><strong>${esc(e.type)}</strong> · ${esc(e.clinician)} ${sourceChip(e.source)}<p class="small">${esc(e.summary)}</p></div></li>`)
        .join('')}</ul>
    </div>`;
}

export function sourceChip(name: string): string {
  const clinic = CLINICS.find((c) => c.short === name);
  return `<span class="source" style="--c:${clinic?.color ?? '#64748b'}">${esc(name)}</span>`;
}
