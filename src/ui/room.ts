import { PATIENT } from '../data/seed';
import type { Booking } from '../lib/booking';
import { clinicianById, type Store } from '../store';
import { esc, fmtTime, initials } from './format';
import { canJoin } from './home';

type Phase = 'check' | 'queue' | 'call' | 'ended';

let timers: number[] = [];
export function leaveRoom() {
  timers.forEach(clearTimeout);
  timers.forEach(clearInterval);
  timers = [];
}

/**
 * Simulated virtual waiting room. A real build would hand off to a video provider
 * (Twilio, Vonage, Daily…). The demo never asks for camera or microphone access.
 */
export function renderRoom(app: HTMLElement, store: Store, id: string) {
  leaveRoom();
  const b = store.bookings().find((x) => x.id === id);
  if (!b || b.type !== 'video') {
    app.innerHTML = '<div class="panel narrow"><h1>Visit not found</h1><p>This link may be for a cancelled or in-person visit.</p><a class="btn" href="#/home">Back to home</a></div>';
    return;
  }
  const c = clinicianById(b.clinicianId);
  const preview = !canJoin(b, Date.now());
  const devices = { camera: true, mic: true, connection: false };
  let phase: Phase = 'check';
  let position = 2;
  let seconds = 0;
  let muted = false;
  let cameraOff = false;

  const set = (p: Phase) => {
    phase = p;
    draw();
  };

  function draw() {
    if (phase === 'check') {
      app.innerHTML = `<div class="room panel narrow">
        ${preview ? `<p class="notice">Preview mode: this visit is at ${fmtTime(b!.start)}. The real waiting room opens 15 minutes before.</p>` : ''}
        <h1>Video visit with ${esc(c.name)}</h1>
        <p class="muted">Let's check your setup. This demo doesn't turn on your camera or microphone.</p>
        <ul class="checks">
          <li><span>Camera</span><button type="button" class="toggle" data-dev="camera" aria-pressed="${devices.camera}">${devices.camera ? 'On' : 'Off'}</button></li>
          <li><span>Microphone</span><button type="button" class="toggle" data-dev="mic" aria-pressed="${devices.mic}">${devices.mic ? 'On' : 'Off'}</button></li>
          <li><span>Connection</span><strong class="${devices.connection ? 'ok' : 'muted'}">${devices.connection ? '✓ Good (simulated 18 Mbps)' : 'Testing…'}</strong></li>
        </ul>
        <button type="button" class="btn btn-primary btn-block" data-checkin ${devices.connection ? '' : 'disabled'}>Check in</button>
        <a class="link small" href="#/home">Back to home</a>
      </div>`;
      app.querySelectorAll<HTMLButtonElement>('[data-dev]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const k = btn.dataset.dev as 'camera' | 'mic';
          devices[k] = !devices[k];
          draw();
        })
      );
      app.querySelector('[data-checkin]')?.addEventListener('click', () => {
        set('queue');
        const tick = window.setInterval(() => {
          position--;
          if (position <= 0) {
            clearInterval(tick);
            muted = !devices.mic;
            cameraOff = !devices.camera;
            set('call');
            const clock = window.setInterval(() => {
              seconds++;
              const el = app.querySelector('[data-clock]');
              if (el) el.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
            }, 1000);
            timers.push(clock);
          } else draw();
        }, 2500);
        timers.push(tick);
      });
      if (!devices.connection) {
        timers.push(window.setTimeout(() => {
          devices.connection = true;
          if (phase === 'check') draw();
        }, 900));
      }
      return;
    }

    if (phase === 'queue') {
      app.innerHTML = `<div class="room panel narrow center">
        <div class="pulse" aria-hidden="true">${initials(c.name)}</div>
        <h1>You're checked in</h1>
        <p>${esc(c.name)} will be with you shortly.</p>
        <p class="queue" aria-live="polite">${position === 1 ? 'You’re next' : `${position} patients ahead of you`}</p>
        <p class="muted small">While you wait: have your medication list nearby and find a quiet, well-lit spot.</p>
      </div>`;
      return;
    }

    if (phase === 'call') {
      app.innerHTML = `<div class="call">
        <div class="call-main">
          <div class="tile big"><div class="tile-avatar">${initials(c.name)}</div><span class="tile-name">${esc(c.name)}</span></div>
          <div class="tile self ${cameraOff ? 'off' : ''}"><div class="tile-avatar small">${initials(PATIENT.name)}</div><span class="tile-name">You${muted ? ' · muted' : ''}</span></div>
          <div class="call-bar"><span class="live">● Live</span><span data-clock>00:00</span></div>
        </div>
        <div class="controls" role="toolbar" aria-label="Call controls">
          <button type="button" data-ctl="mute" aria-pressed="${muted}">${muted ? 'Unmute' : 'Mute'}</button>
          <button type="button" data-ctl="cam" aria-pressed="${cameraOff}">${cameraOff ? 'Start video' : 'Stop video'}</button>
          <button type="button" class="end" data-ctl="end">End visit</button>
        </div>
        <p class="muted small center">Simulated call. In production this view embeds the video provider's SDK.</p>
      </div>`;
      app.querySelector('[data-ctl="mute"]')!.addEventListener('click', () => {
        muted = !muted;
        draw();
      });
      app.querySelector('[data-ctl="cam"]')!.addEventListener('click', () => {
        cameraOff = !cameraOff;
        draw();
      });
      app.querySelector('[data-ctl="end"]')!.addEventListener('click', () => {
        leaveRoom();
        if (!preview) store.setBookings(store.bookings().map((x: Booking) => (x.id === b!.id ? { ...x, status: 'completed' } : x)));
        set('ended');
      });
      return;
    }

    app.innerHTML = `<div class="room panel narrow center">
      <div class="tick" aria-hidden="true">✓</div>
      <h1>Visit ended</h1>
      <p>${preview ? 'That was a preview, so your visit is still booked.' : `Your visit summary from ${esc(c.name)} will appear under Visits within 24 hours.`}</p>
      <div class="row-actions center"><a class="btn" href="#/visits">See visits</a><a class="btn btn-primary" href="#/book">Book a follow-up</a></div>
    </div>`;
  }

  draw();
}
