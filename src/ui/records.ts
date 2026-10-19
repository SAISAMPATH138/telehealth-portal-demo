import { CLINICS, PATIENT, SOURCE_RECORDS } from '../data/seed';
import { mergeRecords, type Merged } from '../lib/records';
import { esc, fmtIsoDate } from './format';
import { sourceChip } from './home';

const record = mergeRecords(SOURCE_RECORDS);

const chips = (sources: string[]) => sources.map(sourceChip).join(' ');
const conflictNote = (m: Merged<unknown>) => (m.conflict ? `<p class="conflict">⚠ ${esc(m.conflict)}</p>` : '');

export function renderRecords(app: HTMLElement) {
  const meds = record.medications;
  app.innerHTML = `<header class="page-head">
      <h1>Health record</h1>
      <p class="muted">${esc(PATIENT.name)} · DOB ${fmtIsoDate(PATIENT.dob)} · MRN ${PATIENT.mrn}. One record, combined from ${CLINICS.length} clinics: ${CLINICS.map((c) => sourceChip(c.short)).join(' ')}</p>
    </header>
    ${record.conflicts ? `<div class="banner"><strong>${record.conflicts} items need review.</strong> Your clinics' records disagree on these. Nothing has been changed automatically; your care team reconciles them with you.</div>` : ''}
    <div class="record-grid">
      <section class="panel span-2">
        <h2>Medications</h2>
        <table class="table">
          <thead><tr><th>Medication</th><th>Dose</th><th>How often</th><th>Status</th><th>Source</th></tr></thead>
          <tbody>${meds
            .map(
              (m) => `<tr class="${m.conflict ? 'has-conflict' : ''}"><td><strong>${esc(m.value.name)}</strong>${conflictNote(m)}</td><td>${esc(m.value.dose)}</td><td>${esc(m.value.frequency)}</td>
                <td><span class="pill cap ${m.value.status === 'active' ? 'pill-good' : 'pill-muted'}">${m.value.status}</span></td><td>${chips(m.sources)}</td></tr>`
            )
            .join('')}</tbody>
        </table>
      </section>
      <section class="panel">
        <h2>Allergies</h2>
        <ul class="list">${record.allergies
          .map((a) => `<li><div class="list-head"><strong>${esc(a.value.substance)}</strong><span class="sev sev-${a.value.severity}">${a.value.severity}</span></div><p class="small">${esc(a.value.reaction)}</p><p>${chips(a.sources)}</p>${conflictNote(a)}</li>`)
          .join('')}</ul>
      </section>
      <section class="panel">
        <h2>Conditions</h2>
        <ul class="list">${record.conditions
          .map((c) => `<li><div class="list-head"><strong>${esc(c.value.name)}</strong><span class="pill cap ${c.value.status === 'active' ? '' : 'pill-muted'}">${c.value.status}</span></div><p class="muted small">${c.value.code} · since ${fmtIsoDate(c.value.onset)}</p><p>${chips(c.sources)}</p>${conflictNote(c)}</li>`)
          .join('')}</ul>
      </section>
      <section class="panel span-2">
        <h2>Lab results</h2>
        <table class="table">
          <thead><tr><th>Test</th><th>Latest</th><th>Reference</th><th>Trend</th><th>Source</th></tr></thead>
          <tbody>${record.labs
            .map((l) => {
              const range = l.latest.low !== undefined && l.latest.high !== undefined ? `${l.latest.low}–${l.latest.high}` : l.latest.high !== undefined ? `< ${l.latest.high}` : `> ${l.latest.low}`;
              const trend = l.history.length > 1 ? l.history.slice().reverse().map((h) => `${h.value}`).join(' → ') : '—';
              return `<tr><td><strong>${esc(l.latest.name)}</strong><p class="muted small">${fmtIsoDate(l.latest.date)}</p></td>
                <td><span class="lab ${l.flag ? 'lab-flag' : ''}">${l.latest.value} ${l.latest.unit}</span>${l.flag ? ` <span class="pill pill-warn">${l.flag}</span>` : ''}</td>
                <td class="muted">${range} ${l.latest.unit}</td><td>${trend}</td><td>${chips(l.sources)}</td></tr>`;
            })
            .join('')}</tbody>
        </table>
      </section>
      <section class="panel span-2">
        <h2>Immunizations</h2>
        <ul class="inline-list">${record.immunizations.map((i) => `<li><strong>${esc(i.value.name)}</strong> <span class="muted small">${fmtIsoDate(i.value.date)}</span> ${chips(i.sources)}</li>`).join('')}</ul>
      </section>
    </div>
    <p class="muted small">How merging works: items are matched on standard codes (RxNorm for medications, ICD-10 for conditions, LOINC for labs, CVX for vaccines). Duplicate results from two systems are shown once, with every source credited, and disagreements are flagged rather than silently resolved.</p>`;
}
