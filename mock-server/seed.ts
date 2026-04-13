import { faker } from '@faker-js/faker';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Types (lite) ─────────────────────────────────────────────────────────────
type BedStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'blocked';
type AcuityLevel = 1 | 2 | 3 | 4 | 5;
type PatientStatus = 'admitted' | 'discharging' | 'transferred' | 'pending_admission' | 'observation';

const UNIT_TYPES = ['cardiac', 'neuro', 'surgical', 'icu', 'peds', 'oncology', 'stepdown', 'ed'] as const;
const ROLES = ['attending', 'resident', 'nurse', 'charge_nurse', 'respiratory', 'pharmacist', 'pt', 'ot'] as const;
const SHIFTS = ['day', 'evening', 'night'] as const;
const FALL_RISKS = ['low', 'moderate', 'high'] as const;
const CODE_STATUSES = ['full', 'dnr', 'dni', 'dnar'] as const;
const ISOLATION_TYPES = ['contact', 'droplet', 'airborne', null, null, null] as const;
const ALERT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

// ─── Generate Units ───────────────────────────────────────────────────────────
const units = UNIT_TYPES.map((type, i) => ({
  id: `unit-${String(i + 1).padStart(2, '0')}`,
  name: `${type.charAt(0).toUpperCase() + type.slice(1)} Unit`,
  type,
  floor: faker.number.int({ min: 2, max: 8 }),
  capacity: faker.number.int({ min: 20, max: 40 }),
  supervisor_id: `staff-sup-${i + 1}`,
}));

// ─── Generate Beds ────────────────────────────────────────────────────────────
const beds: unknown[] = [];
const bedIds: string[] = [];

units.forEach((unit) => {
  const count = faker.number.int({ min: 20, max: 30 });
  const roomNums = faker.helpers.uniqueArray(() =>
    unit.type === 'icu'
      ? `ICU-${String(faker.number.int({ min: 1, max: 20 })).padStart(2, '0')}`
      : `${faker.number.int({ min: 100, max: 399 })}`,
    Math.ceil(count / 2)
  );

  let bedCount = 0;
  for (const room of roomNums) {
    for (const suffix of ['A', 'B']) {
      if (bedCount >= count) break;
      const status: BedStatus = faker.helpers.weightedArrayElement([
        { value: 'available', weight: 25 },
        { value: 'occupied', weight: 55 },
        { value: 'cleaning', weight: 10 },
        { value: 'maintenance', weight: 5 },
        { value: 'blocked', weight: 5 },
      ]);
      const bedId = `${unit.id}-${room}${suffix}`;
      bedIds.push(bedId);
      beds.push({
        id: bedId,
        unit_id: unit.id,
        room: `${room}`,
        label: suffix,
        status,
        patient_id: null, // filled in when patients are generated
        isolation_type: faker.helpers.arrayElement(ISOLATION_TYPES as unknown as string[]),
        telemetry_equipped: faker.datatype.boolean({ probability: 0.6 }),
        updated_at: faker.date.recent({ days: 1 }).toISOString(),
      });
      bedCount++;
    }
  }
});

// ─── Generate Patients ────────────────────────────────────────────────────────
const patients: unknown[] = [];
const patientIds: string[] = [];

const availableBeds = beds.filter(
  (b) => (b as { status: BedStatus }).status === 'occupied' || (b as { status: BedStatus }).status === 'available'
);

for (let i = 0; i < 450; i++) {
  const unit = faker.helpers.arrayElement(units);
  const acuity = faker.number.int({ min: 1, max: 5 }) as AcuityLevel;
  const status: PatientStatus = faker.helpers.weightedArrayElement([
    { value: 'admitted', weight: 60 },
    { value: 'observation', weight: 15 },
    { value: 'discharging', weight: 10 },
    { value: 'pending_admission', weight: 10 },
    { value: 'transferred', weight: 5 },
  ]);

  // Assign bed
  const eligibleBeds = availableBeds.filter(
    (b) => (b as { unit_id: string }).unit_id === unit.id &&
            (b as { patient_id: string | null }).patient_id === null
  );
  let bedId: string | null = null;
  if (eligibleBeds.length > 0 && status === 'admitted') {
    const bed = faker.helpers.arrayElement(eligibleBeds) as { id: string; patient_id: string };
    bed.patient_id = `patient-${String(i + 1).padStart(4, '0')}`;
    bedId = bed.id;
  }

  const patientId = `patient-${String(i + 1).padStart(4, '0')}`;
  patientIds.push(patientId);

  const losHours = faker.number.float({ min: 1, max: 200, fractionDigits: 1 });
  const expectedDischarge = faker.datatype.boolean({ probability: 0.7 })
    ? faker.date.soon({ days: 3 }).toISOString()
    : null;

  // Vitals
  const vitals = Array.from({ length: faker.number.int({ min: 3, max: 8 }) }, () => ({
    timestamp: faker.date.recent({ days: 2 }).toISOString(),
    hr: faker.number.int({ min: 55, max: 110 }),
    bp_sys: faker.number.int({ min: 90, max: 160 }),
    bp_dia: faker.number.int({ min: 60, max: 100 }),
    spo2: faker.number.int({ min: 92, max: 100 }),
    temp_c: faker.number.float({ min: 36.1, max: 38.5, fractionDigits: 1 }),
    rr: faker.number.int({ min: 12, max: 22 }),
  })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Flags
  const flags = faker.helpers.maybe(() => [
    {
      type: faker.helpers.arrayElement(['fall_risk', 'allergy', 'isolation', 'observation', 'review', 'critical']),
      label: faker.helpers.arrayElement(['Fall Risk', 'Allergy: Penicillin', 'MRSA Isolation', 'Observation Only', 'Needs Review', 'Critical Watch']),
      acknowledged: faker.datatype.boolean({ probability: 0.3 }),
      created_at: faker.date.recent({ days: 1 }).toISOString(),
    },
  ], { probability: 0.4 }) ?? [];

  // Care team
  const careTeam = Array.from({ length: faker.number.int({ min: 1, max: 3 }) }, () => ({
    role: faker.helpers.arrayElement(ROLES),
    provider_id: faker.string.uuid(),
    name: faker.person.fullName(),
  }));

  const isolationType = faker.helpers.arrayElement(ISOLATION_TYPES as unknown as Array<string | null>);

  patients.push({
    id: patientId,
    mrn: faker.string.alphanumeric({ length: 8, casing: 'upper' }),
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    dob: faker.date.birthdate({ min: 18, max: 90, mode: 'age' }).toISOString().split('T')[0],
    unit_id: unit.id,
    bed_id: bedId,
    acuity,
    status,
    admitting_dx: faker.helpers.arrayElement([
      'Acute MI', 'CHF Exacerbation', 'Pneumonia', 'Sepsis', 'COPD Exacerbation',
      'Stroke', 'Hip Fracture', 'GI Bleed', 'DKA', 'Pulmonary Embolism',
      'Acute Kidney Injury', 'Cellulitis', 'UTI', 'Appendicitis', 'Cholecystitis',
    ]),
    chief_complaint: faker.helpers.arrayElement([
      'Chest pain', 'Shortness of breath', 'Abdominal pain', 'Altered mental status',
      'Fever', 'Dizziness', 'Weakness', 'Palpitations', 'Back pain', 'Nausea/vomiting',
    ]),
    los_hours: losHours,
    expected_discharge: expectedDischarge,
    attending_provider_id: faker.string.uuid(),
    care_team: careTeam,
    flags,
    vitals,
    notes: [],
    fall_risk: faker.helpers.arrayElement(FALL_RISKS),
    isolation_type: isolationType,
    code_status: faker.helpers.arrayElement(CODE_STATUSES),
    etag: crypto.randomUUID(),
    updated_at: faker.date.recent({ days: 1 }).toISOString(),
  });
}

// ─── Generate Staff ───────────────────────────────────────────────────────────
const staff: unknown[] = [];

for (let i = 0; i < 80; i++) {
  const unit = faker.helpers.arrayElement(units);
  const assignedPatients = patientIds
    .filter(() => faker.datatype.boolean({ probability: 0.1 }))
    .slice(0, faker.number.int({ min: 3, max: 8 }));

  staff.push({
    id: `staff-${String(i + 1).padStart(3, '0')}`,
    name: faker.person.fullName(),
    role: faker.helpers.arrayElement(ROLES),
    unit_id: unit.id,
    shift: faker.helpers.arrayElement(SHIFTS),
    patient_ids: assignedPatients,
  });
}

// ─── Generate Alerts ──────────────────────────────────────────────────────────
const alerts: unknown[] = [];

const alertMessages: Record<string, string[]> = {
  critical: [
    'Cardiac arrest detected — code blue initiated',
    'Respiratory failure — immediate intervention required',
    'Critical SpO2 drop below 88% — room {room}',
    'Unresponsive patient — nurse to bedside immediately',
  ],
  high: [
    'BP critically elevated: 180/110 — Bed {room}',
    'Tachycardia >130 bpm — Patient requires assessment',
    'Blood sugar critically low: 45 mg/dL',
    'Fall detected — patient on floor, room {room}',
  ],
  medium: [
    'Medication due in 30 minutes: Anticoagulant',
    'IV bag empty — replacement needed',
    'Patient requesting pain medication',
    'Telemetry lead disconnect — Bed {room}',
  ],
  low: [
    'Patient call light activated',
    'Meal tray not collected',
    'Lab results available for review',
    'Visitor requesting nurse assistance',
  ],
};

for (let i = 0; i < 40; i++) {
  const unit = faker.helpers.arrayElement(units);
  const severity = faker.helpers.arrayElement(ALERT_SEVERITIES);
  const status = faker.helpers.weightedArrayElement([
    { value: 'active', weight: 60 },
    { value: 'acknowledged', weight: 30 },
    { value: 'resolved', weight: 10 },
  ]);

  const messages = alertMessages[severity] ?? alertMessages.medium;
  const message = faker.helpers.arrayElement(messages).replace('{room}', `${faker.number.int({ min: 100, max: 399 })}A`);

  const createdAt = faker.date.recent({ days: 1 });
  const acknowledgedAt = status !== 'active' ? new Date(createdAt.getTime() + faker.number.int({ min: 60000, max: 600000 })).toISOString() : null;
  const resolvedAt = status === 'resolved' ? new Date(createdAt.getTime() + faker.number.int({ min: 600000, max: 3600000 })).toISOString() : null;

  alerts.push({
    id: `alert-${String(i + 1).padStart(3, '0')}`,
    unit_id: unit.id,
    patient_id: faker.helpers.maybe(() => faker.helpers.arrayElement(patientIds), { probability: 0.7 }),
    bed_id: faker.helpers.maybe(() => faker.helpers.arrayElement(bedIds), { probability: 0.5 }),
    severity,
    status,
    message,
    created_at: createdAt.toISOString(),
    acknowledged_at: acknowledgedAt,
    resolved_at: resolvedAt,
  });
}

// ─── Write output ─────────────────────────────────────────────────────────────
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const output = { units, beds, patients, staff, alerts };
writeFileSync(join(dataDir, 'hospital.json'), JSON.stringify(output, null, 2));

console.log(`✅ Seed complete:
  Units:    ${units.length}
  Beds:     ${beds.length}
  Patients: ${patients.length}
  Staff:    ${staff.length}
  Alerts:   ${alerts.length}
→ Written to mock-server/data/hospital.json`);
