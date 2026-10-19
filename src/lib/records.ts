/**
 * Unified patient record: merges records pulled from several clinics' systems,
 * de-duplicating by standard code and flagging disagreements for clinician review.
 * Shapes loosely follow FHIR resources (MedicationStatement, AllergyIntolerance…).
 */

export interface Source {
  id: string;
  name: string;
}

export interface Medication {
  code: string; // RxNorm-style
  name: string;
  dose: string;
  frequency: string;
  status: 'active' | 'stopped';
  updated: string; // ISO date
}

export interface Allergy {
  code: string;
  substance: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
  recorded: string;
}

export interface Condition {
  code: string; // ICD-10
  name: string;
  onset: string;
  status: 'active' | 'resolved';
}

export interface Immunization {
  code: string; // CVX
  name: string;
  date: string;
}

export interface Encounter {
  date: string;
  type: string;
  clinician: string;
  summary: string;
}

export interface Lab {
  code: string; // LOINC
  name: string;
  value: number;
  unit: string;
  low?: number;
  high?: number;
  date: string;
}

export interface SourceRecord {
  source: Source;
  medications: Medication[];
  allergies: Allergy[];
  conditions: Condition[];
  immunizations: Immunization[];
  encounters: Encounter[];
  labs: Lab[];
}

export interface Merged<T> {
  value: T;
  sources: string[];
  /** Human-readable description of a disagreement between sources. */
  conflict?: string;
}

export interface LabSeries {
  latest: Lab;
  history: (Lab & { source: string })[];
  flag: 'low' | 'high' | null;
  sources: string[];
}

export interface UnifiedRecord {
  medications: Merged<Medication>[];
  allergies: Merged<Allergy>[];
  conditions: Merged<Condition>[];
  immunizations: Merged<Immunization>[];
  encounters: (Encounter & { source: string })[];
  labs: LabSeries[];
  conflicts: number;
}

const SEVERITY = { mild: 0, moderate: 1, severe: 2 } as const;
const byDateDesc = <T extends { date: string }>(a: T, b: T) => b.date.localeCompare(a.date);

function groupBy<T>(records: SourceRecord[], pick: (r: SourceRecord) => T[], key: (t: T) => string) {
  const groups = new Map<string, { item: T; source: Source }[]>();
  for (const r of records) {
    for (const item of pick(r)) {
      const k = key(item);
      groups.set(k, [...(groups.get(k) ?? []), { item, source: r.source }]);
    }
  }
  return [...groups.values()];
}

const uniqueNames = (entries: { source: Source }[]) => [...new Set(entries.map((e) => e.source.name))];

function mergeMedications(records: SourceRecord[]): Merged<Medication>[] {
  return groupBy(records, (r) => r.medications, (m) => m.code).map((entries) => {
    const sorted = [...entries].sort((a, b) => b.item.updated.localeCompare(a.item.updated));
    const latest = sorted[0].item;
    const activeDoses = sorted.filter((e) => e.item.status === 'active');
    const doses = new Set(activeDoses.map((e) => e.item.dose));
    let conflict: string | undefined;
    if (doses.size > 1) {
      conflict = `Dose differs between sources: ${[...activeDoses].reverse().map((e) => `${e.item.dose} (${e.source.name}, ${e.item.updated})`).join(' vs ')}`;
    } else if (activeDoses.length && latest.status === 'stopped') {
      const stillActive = activeDoses.map((e) => e.source.name).join(', ');
      conflict = `Marked stopped on ${latest.updated} but still active at ${stillActive}`;
    }
    return { value: latest, sources: uniqueNames(entries), conflict };
  });
}

function mergeAllergies(records: SourceRecord[]): Merged<Allergy>[] {
  return groupBy(records, (r) => r.allergies, (a) => a.code).map((entries) => {
    // Keep the most severe classification and every distinct reaction reported.
    const worst = entries.reduce((w, e) => (SEVERITY[e.item.severity] > SEVERITY[w.item.severity] ? e : w));
    const reactions = [...new Set(entries.map((e) => e.item.reaction))];
    const severities = new Set(entries.map((e) => e.item.severity));
    return {
      value: { ...worst.item, reaction: reactions.join('; ') },
      sources: uniqueNames(entries),
      conflict: severities.size > 1 ? `Severity recorded differently (${[...severities].join(', ')}). Showing the most severe.` : undefined
    };
  });
}

function mergeConditions(records: SourceRecord[]): Merged<Condition>[] {
  return groupBy(records, (r) => r.conditions, (c) => c.code).map((entries) => {
    const earliestOnset = entries.reduce((a, e) => (e.item.onset < a ? e.item.onset : a), entries[0].item.onset);
    const statuses = new Set(entries.map((e) => e.item.status));
    return {
      value: { ...entries[0].item, onset: earliestOnset, status: statuses.has('active') ? 'active' : 'resolved' },
      sources: uniqueNames(entries),
      conflict: statuses.size > 1 ? 'Active at one clinic, resolved at another' : undefined
    };
  });
}

function mergeImmunizations(records: SourceRecord[]): Merged<Immunization>[] {
  return groupBy(records, (r) => r.immunizations, (i) => `${i.code}|${i.date}`)
    .map((entries) => ({ value: entries[0].item, sources: uniqueNames(entries) }))
    .sort((a, b) => b.value.date.localeCompare(a.value.date));
}

function mergeLabs(records: SourceRecord[]): LabSeries[] {
  return groupBy(records, (r) => r.labs, (l) => l.code)
    .map((entries) => {
      // The same result often arrives from two systems; keep one per date and value.
      const seen = new Set<string>();
      const history = entries
        .map((e) => ({ ...e.item, source: e.source.name }))
        .filter((l) => {
          const k = `${l.date}|${l.value}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort(byDateDesc);
      const latest = history[0];
      const flag = latest.low !== undefined && latest.value < latest.low ? 'low' : latest.high !== undefined && latest.value > latest.high ? 'high' : null;
      return { latest, history, flag, sources: uniqueNames(entries) } as LabSeries;
    })
    .sort((a, b) => a.latest.name.localeCompare(b.latest.name));
}

export function mergeRecords(records: SourceRecord[]): UnifiedRecord {
  const medications = mergeMedications(records).sort(
    (a, b) => (a.value.status === b.value.status ? a.value.name.localeCompare(b.value.name) : a.value.status === 'active' ? -1 : 1)
  );
  const allergies = mergeAllergies(records).sort((a, b) => SEVERITY[b.value.severity] - SEVERITY[a.value.severity]);
  const conditions = mergeConditions(records).sort((a, b) => (a.value.status === b.value.status ? 0 : a.value.status === 'active' ? -1 : 1));
  const immunizations = mergeImmunizations(records);
  const encounters = records.flatMap((r) => r.encounters.map((e) => ({ ...e, source: r.source.name }))).sort(byDateDesc);
  const labs = mergeLabs(records);
  const conflicts = [medications, allergies, conditions].flat().filter((m) => m.conflict).length;
  return { medications, allergies, conditions, immunizations, encounters, labs, conflicts };
}
