import type { SourceRecord } from '../lib/records';
import { addDays, atMinutes, type TimeRange, type WeeklySchedule } from '../lib/slots';

// Everything in this file is fictional demo data. No real patients, clinicians or clinics.

export interface Clinician {
  id: string;
  name: string;
  specialty: Specialty;
  clinicId: string;
  visitMinutes: number;
  languages: string[];
  bio: string;
  videoVisits: boolean;
  videoOnly?: boolean;
  schedule: WeeklySchedule;
}

export type Specialty = 'Family medicine' | 'Dermatology' | 'Cardiology' | 'Mental health' | 'Pediatrics' | 'Physical therapy';

export const SPECIALTIES: { id: Specialty; blurb: string; icon: string }[] = [
  { id: 'Family medicine', blurb: 'Check-ups, illness, prescriptions', icon: '🩺' },
  { id: 'Mental health', blurb: 'Therapy and counselling', icon: '💬' },
  { id: 'Dermatology', blurb: 'Skin, hair and nails', icon: '🔍' },
  { id: 'Cardiology', blurb: 'Heart and blood pressure', icon: '❤️' },
  { id: 'Pediatrics', blurb: 'Care for children and teens', icon: '🧸' },
  { id: 'Physical therapy', blurb: 'Injury recovery and mobility', icon: '🦵' }
];

export const CLINICS = [
  { id: 'harbourview', name: 'Harbourview Family Clinic', short: 'Harbourview', color: '#2563EB' },
  { id: 'northgate', name: 'Northgate Medical Group', short: 'Northgate', color: '#7C3AED' },
  { id: 'riverside', name: 'Riverside Specialty Center', short: 'Riverside', color: '#0F766E' }
] as const;

const h = (hours: number) => hours * 60;
const weekdays = (windows: [number, number][]): WeeklySchedule => ({ 1: windows, 2: windows, 3: windows, 4: windows, 5: windows });

export const CLINICIANS: Clinician[] = [
  { id: 'c1', name: 'Dr. Amara Okafor', specialty: 'Family medicine', clinicId: 'harbourview', visitMinutes: 20, languages: ['English', 'Igbo'], videoVisits: true, bio: 'Preventive care and chronic condition management.', schedule: weekdays([[h(8), h(12)], [h(13), h(17)]]) },
  { id: 'c2', name: 'Dr. Daniel Reyes', specialty: 'Family medicine', clinicId: 'northgate', visitMinutes: 20, languages: ['English', 'Spanish'], videoVisits: true, bio: 'Same-week appointments for new and existing patients.', schedule: { ...weekdays([[h(9), h(13)], [h(14), h(18)]]), 6: [[h(9), h(12)]] } },
  { id: 'c3', name: 'Dr. Mei Lin Chen', specialty: 'Family medicine', clinicId: 'harbourview', visitMinutes: 30, languages: ['English', 'Mandarin'], videoVisits: false, bio: 'Longer visits for complex care and care coordination.', schedule: { 1: [[h(10), h(16)]], 3: [[h(10), h(16)]], 5: [[h(8), h(12)]] } },
  { id: 'c4', name: 'Sam Whitaker, LCSW', specialty: 'Mental health', clinicId: 'northgate', visitMinutes: 45, languages: ['English'], videoVisits: true, videoOnly: true, bio: 'Anxiety, stress and life transitions. Video sessions only.', schedule: { 1: [[h(12), h(20)]], 2: [[h(12), h(20)]], 4: [[h(9), h(17)]] } },
  { id: 'c5', name: 'Dr. Priya Natarajan', specialty: 'Dermatology', clinicId: 'riverside', visitMinutes: 15, languages: ['English', 'Tamil'], videoVisits: true, bio: 'Photo-based video consults for rashes, acne and moles.', schedule: { 2: [[h(8), h(12)]], 3: [[h(13), h(17)]], 5: [[h(8), h(14)]] } },
  { id: 'c6', name: 'Dr. Robert Haines', specialty: 'Cardiology', clinicId: 'riverside', visitMinutes: 30, languages: ['English'], videoVisits: true, bio: 'Hypertension, cholesterol and follow-up after cardiac events.', schedule: { 1: [[h(8), h(12)]], 4: [[h(13), h(17)]] } },
  { id: 'c7', name: 'Dr. Elena Petrova', specialty: 'Pediatrics', clinicId: 'harbourview', visitMinutes: 20, languages: ['English', 'Russian'], videoVisits: true, bio: 'Newborn to 18. Sick visits and developmental check-ins.', schedule: weekdays([[h(8), h(12)]]) },
  { id: 'c8', name: 'Marcus Bell, DPT', specialty: 'Physical therapy', clinicId: 'northgate', visitMinutes: 45, languages: ['English'], videoVisits: true, bio: 'Guided home exercise programs over video.', schedule: { 2: [[h(7), h(15)]], 4: [[h(7), h(15)]], 6: [[h(8), h(12)]] } }
];

export const PATIENT = { id: 'pt_demo', name: 'Jordan Rivera', dob: '1984-05-14', mrn: 'DEMO-000142' };

/** Deterministic pseudo-random per string, so other patients' bookings look the same on every visit. */
function hash01(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  x ^= x >>> 13;
  x = Math.imul(x, 0x5bd1e995);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/** Slots already taken by other (fictional) patients: denser in the next few days, sparser later. */
export function otherPatientsBusy(c: Clinician, from: Date, days: number): TimeRange[] {
  const busy: TimeRange[] = [];
  for (let d = 0; d < days; d++) {
    const day = addDays(from, d);
    const density = d < 3 ? 0.7 : d < 7 ? 0.5 : 0.3;
    for (const [open, close] of c.schedule[day.getDay()] ?? []) {
      for (let m = open; m + c.visitMinutes <= close; m += c.visitMinutes) {
        const start = atMinutes(day, m).getTime();
        if (hash01(`${c.id}:${start}`) < density) busy.push({ start, end: start + c.visitMinutes * 60_000 });
      }
    }
  }
  return busy;
}

// Records as three different clinic systems would return them, overlaps and disagreements included.
export const SOURCE_RECORDS: SourceRecord[] = [
  {
    source: { id: 'harbourview', name: 'Harbourview' },
    medications: [
      { code: '314076', name: 'Lisinopril', dose: '10 mg', frequency: 'Once daily', status: 'active', updated: '2026-02-11' },
      { code: '617312', name: 'Atorvastatin', dose: '20 mg', frequency: 'Once daily at night', status: 'active', updated: '2026-02-11' },
      { code: '310965', name: 'Ibuprofen', dose: '400 mg', frequency: 'As needed', status: 'active', updated: '2025-09-02' }
    ],
    allergies: [{ code: '7980', substance: 'Penicillin', reaction: 'Hives', severity: 'moderate', recorded: '2019-06-20' }],
    conditions: [
      { code: 'I10', name: 'Essential hypertension', onset: '2021-03-08', status: 'active' },
      { code: 'M54.5', name: 'Low back pain', onset: '2025-08-30', status: 'active' }
    ],
    immunizations: [
      { code: '141', name: 'Influenza, seasonal', date: '2025-10-04' },
      { code: '115', name: 'Tdap', date: '2022-01-17' }
    ],
    encounters: [
      { date: '2026-02-11', type: 'Annual physical', clinician: 'Dr. Amara Okafor', summary: 'BP 138/86. Continue lisinopril. Lipid panel ordered.' },
      { date: '2025-09-02', type: 'Video visit', clinician: 'Dr. Amara Okafor', summary: 'Acute low back strain. Ibuprofen and stretching plan; PT referral.' }
    ],
    labs: [
      { code: '2093-3', name: 'Total cholesterol', value: 228, unit: 'mg/dL', high: 200, date: '2026-02-13' },
      { code: '4548-4', name: 'Hemoglobin A1c', value: 5.6, unit: '%', high: 5.7, date: '2026-02-13' }
    ]
  },
  {
    source: { id: 'northgate', name: 'Northgate' },
    medications: [
      { code: '314076', name: 'Lisinopril', dose: '10 mg', frequency: 'Once daily', status: 'active', updated: '2025-11-20' },
      { code: '310965', name: 'Ibuprofen', dose: '400 mg', frequency: 'As needed', status: 'stopped', updated: '2026-01-15' },
      { code: '312938', name: 'Sertraline', dose: '50 mg', frequency: 'Once daily', status: 'active', updated: '2026-04-02' }
    ],
    allergies: [
      { code: '7980', substance: 'Penicillin', reaction: 'Rash', severity: 'moderate', recorded: '2020-02-03' },
      { code: '1191', substance: 'Aspirin', reaction: 'Stomach upset', severity: 'mild', recorded: '2023-07-12' }
    ],
    conditions: [
      { code: 'F41.1', name: 'Generalized anxiety disorder', onset: '2026-03-18', status: 'active' },
      { code: 'M54.5', name: 'Low back pain', onset: '2025-09-10', status: 'resolved' }
    ],
    immunizations: [
      { code: '141', name: 'Influenza, seasonal', date: '2025-10-04' },
      { code: '208', name: 'COVID-19, mRNA', date: '2025-10-04' }
    ],
    encounters: [
      { date: '2026-04-02', type: 'Video visit', clinician: 'Sam Whitaker, LCSW', summary: 'Follow-up. Sleep improving; continue weekly sessions.' },
      { date: '2026-01-15', type: 'Physical therapy', clinician: 'Marcus Bell, DPT', summary: 'Discharged from PT. Back pain resolved; home program continues.' }
    ],
    labs: [{ code: '4548-4', name: 'Hemoglobin A1c', value: 5.6, unit: '%', high: 5.7, date: '2026-02-13' }]
  },
  {
    source: { id: 'riverside', name: 'Riverside' },
    medications: [
      { code: '617312', name: 'Atorvastatin', dose: '40 mg', frequency: 'Once daily at night', status: 'active', updated: '2026-07-22' }
    ],
    allergies: [{ code: '7980', substance: 'Penicillin', reaction: 'Swelling of lips', severity: 'severe', recorded: '2026-07-22' }],
    conditions: [{ code: 'E78.5', name: 'Hyperlipidemia', onset: '2026-02-13', status: 'active' }],
    immunizations: [],
    encounters: [
      { date: '2026-07-22', type: 'Cardiology consult', clinician: 'Dr. Robert Haines', summary: 'LDL above goal on atorvastatin 20 mg; increased to 40 mg. Recheck lipids in 3 months.' }
    ],
    labs: [
      { code: '2093-3', name: 'Total cholesterol', value: 196, unit: 'mg/dL', high: 200, date: '2026-07-20' },
      { code: '13457-7', name: 'LDL cholesterol', value: 112, unit: 'mg/dL', high: 100, date: '2026-07-20' }
    ]
  }
];
