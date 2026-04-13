import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Load Data ────────────────────────────────────────────────────────────────
interface HospitalData {
  units: Unit[];
  beds: Bed[];
  patients: Patient[];
  staff: StaffMember[];
  alerts: Alert[];
}

interface Unit { id: string; name: string; type: string; floor: number; capacity: number; supervisor_id: string; }
interface Bed { id: string; unit_id: string; room: string; label: string; status: string; patient_id: string | null; isolation_type: string | null; telemetry_equipped: boolean; updated_at: string; }
interface Patient { id: string; mrn: string; first_name: string; last_name: string; dob: string; unit_id: string; bed_id: string | null; acuity: number; status: string; admitting_dx: string; chief_complaint: string; los_hours: number; expected_discharge: string | null; attending_provider_id: string | null; care_team: unknown[]; flags: unknown[]; vitals: unknown[]; notes: unknown[]; fall_risk: string; isolation_type: string | null; code_status: string; etag: string; updated_at: string; }
interface StaffMember { id: string; name: string; role: string; unit_id: string; shift: string; patient_ids: string[]; }
interface Alert { id: string; unit_id: string; patient_id: string | null; bed_id: string | null; severity: string; status: string; message: string; created_at: string; acknowledged_at: string | null; resolved_at: string | null; }

let db: HospitalData;
try {
  db = JSON.parse(readFileSync(join(__dirname, 'data', 'hospital.json'), 'utf-8')) as HospitalData;
  console.log('✅ Loaded hospital.json');
} catch {
  console.error('❌ Run "npm run seed" first to generate mock-server/data/hospital.json');
  process.exit(1);
}

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── REST Endpoints ───────────────────────────────────────────────────────────
app.get('/api/v1/units', (_req: Request, res: Response) => {
  res.json(db.units);
});

app.get('/api/v1/units/:unitId/census', (req: Request, res: Response) => {
  const { unitId } = req.params;
  const beds = db.beds.filter((b) => b.unit_id === unitId);
  const patients = db.patients.filter((p) => p.unit_id === unitId);

  const by_acuity: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const by_status: Record<string, number> = {};
  let total_los = 0;
  let over_target = 0;
  let beds_available = 0;

  for (const p of patients) {
    by_acuity[p.acuity] = (by_acuity[p.acuity] ?? 0) + 1;
    by_status[p.status] = (by_status[p.status] ?? 0) + 1;
    total_los += p.los_hours;
    if (p.los_hours > 72) over_target++;
    if (!p.bed_id) beds_available++;
  }

  res.json({
    by_acuity,
    by_status,
    avg_los: patients.length > 0 ? total_los / patients.length : 0,
    patients_over_target_los: over_target,
    beds_available,
    nurse_ratio_violations: [],
    beds,
  });
});

app.get('/api/v1/patients', (req: Request, res: Response) => {
  const {
    unit_id, status, acuity, search,
    sort_by = 'acuity', sort_dir = 'asc',
    page = '1', limit = '100',
  } = req.query as Record<string, string>;

  let result = [...db.patients];

  if (unit_id) result = result.filter((p) => p.unit_id === unit_id);
  if (status) {
    const statuses = status.split(',');
    result = result.filter((p) => statuses.includes(p.status));
  }
  if (acuity) {
    const acuities = acuity.split(',').map(Number);
    result = result.filter((p) => acuities.includes(p.acuity));
  }
  if (search) {
    const q = search.toLowerCase();
    result = result.filter((p) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      p.mrn.toLowerCase().includes(q) ||
      p.chief_complaint.toLowerCase().includes(q) ||
      p.admitting_dx.toLowerCase().includes(q)
    );
  }

  // Sort
  result.sort((a, b) => {
    let cmp = 0;
    switch (sort_by) {
      case 'name': cmp = `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`); break;
      case 'acuity': cmp = a.acuity - b.acuity; break;
      case 'los': cmp = a.los_hours - b.los_hours; break;
      case 'last_event': cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(); break;
    }
    return sort_dir === 'desc' ? -cmp : cmp;
  });

  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 500);
  const paginated = result.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json(paginated);
});

app.get('/api/v1/patients/:id', (req: Request, res: Response) => {
  const patient = db.patients.find((p) => p.id === req.params.id);
  if (!patient) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(patient);
});

app.post('/api/v1/patients/:id/admit', (req: Request, res: Response) => {
  const patient = db.patients.find((p) => p.id === req.params.id);
  if (!patient) { res.status(404).json({ error: 'Not found' }); return; }

  const ifMatch = req.headers['if-match'];
  if (ifMatch !== patient.etag) {
    // 15% random conflict chance even if etag matches
  }

  if (Math.random() < 0.15) {
    res.status(409).json({ error: 'conflict', current_etag: patient.etag, current_state: patient });
    return;
  }

  patient.etag = crypto.randomUUID();
  patient.status = 'admitted';
  patient.updated_at = new Date().toISOString();
  if (req.body?.bed_id) patient.bed_id = req.body.bed_id as string;
  res.json(patient);
});

app.post('/api/v1/patients/:id/discharge', (req: Request, res: Response) => {
  const patient = db.patients.find((p) => p.id === req.params.id);
  if (!patient) { res.status(404).json({ error: 'Not found' }); return; }
  patient.status = 'discharging';
  patient.etag = crypto.randomUUID();
  patient.updated_at = new Date().toISOString();
  res.json(patient);
});

app.post('/api/v1/patients/:id/transfer', (req: Request, res: Response) => {
  const patient = db.patients.find((p) => p.id === req.params.id);
  if (!patient) { res.status(404).json({ error: 'Not found' }); return; }
  patient.status = 'transferred';
  patient.etag = crypto.randomUUID();
  if (req.body?.to_bed_id) patient.bed_id = req.body.to_bed_id as string;
  if (req.body?.to_unit_id) patient.unit_id = req.body.to_unit_id as string;
  patient.updated_at = new Date().toISOString();
  res.json(patient);
});

app.get('/api/v1/staff', (req: Request, res: Response) => {
  const { unit_id, role, shift } = req.query as Record<string, string>;
  let result = [...db.staff];
  if (unit_id) result = result.filter((s) => s.unit_id === unit_id);
  if (role) result = result.filter((s) => s.role === role);
  if (shift) result = result.filter((s) => s.shift === shift);
  res.json(result);
});

app.get('/api/v1/alerts', (req: Request, res: Response) => {
  const { unit_id, severity, status } = req.query as Record<string, string>;
  let result = [...db.alerts];
  if (unit_id) result = result.filter((a) => a.unit_id === unit_id);
  if (severity) result = result.filter((a) => severity.split(',').includes(a.severity));
  if (status) result = result.filter((a) => status.split(',').includes(a.status));
  res.json(result);
});

app.post('/api/v1/alerts/:id/acknowledge', (req: Request, res: Response) => {
  const alert = db.alerts.find((a) => a.id === req.params.id);
  if (!alert) { res.status(404).json({ error: 'Not found' }); return; }
  alert.status = 'acknowledged';
  alert.acknowledged_at = new Date().toISOString();
  res.json(alert);
});

app.get('/api/v1/summary/unit-stats', (req: Request, res: Response) => {
  const { unit_id } = req.query as Record<string, string>;
  const patients = unit_id
    ? db.patients.filter((p) => p.unit_id === unit_id)
    : db.patients;
  res.json({
    total_patients: patients.length,
    avg_acuity: patients.length > 0
      ? (patients.reduce((s, p) => s + p.acuity, 0) / patients.length).toFixed(2)
      : 0,
  });
});

// ─── SSE Endpoint ─────────────────────────────────────────────────────────────
type SSEClient = { res: Response; unitId: string };
const sseClients: SSEClient[] = [];

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getUnitBeds(unitId: string) {
  return db.beds.filter((b) => b.unit_id === unitId);
}

function getUnitPatients(unitId: string) {
  return db.patients.filter((p) => p.unit_id === unitId);
}

function getUnitAlerts(unitId: string) {
  return db.alerts.filter((a) => a.unit_id === unitId && a.status === 'active');
}

app.get('/stream', (req: Request, res: Response) => {
  const unitId = (req.query.unit_id as string) ?? '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client: SSEClient = { res, unitId };
  sseClients.push(client);

  function emit(type: string, payload: unknown) {
    res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
  }

  const intervals: ReturnType<typeof setInterval>[] = [];

  // HEARTBEAT — every 10s
  intervals.push(setInterval(() => {
    emit('HEARTBEAT', { server_time: new Date().toISOString() });
  }, 10_000));

  // BED_STATUS_CHANGED — 1–3s
  intervals.push(setInterval(() => {
    const beds = getUnitBeds(unitId);
    if (beds.length === 0) return;
    const bed = beds[Math.floor(Math.random() * beds.length)];
    const statuses: string[] = ['available', 'occupied', 'cleaning', 'maintenance', 'blocked'];
    const newStatus = statuses[Math.floor(Math.random() * statuses.length)];
    bed.status = newStatus;
    bed.updated_at = new Date().toISOString();
    emit('BED_STATUS_CHANGED', { bed_id: bed.id, new_status: newStatus });
  }, randomBetween(1000, 3000)));

  // PATIENT_ADMITTED — 30–90s
  intervals.push(setInterval(() => {
    const patients = getUnitPatients(unitId);
    if (patients.length === 0) return;
    const p = patients[Math.floor(Math.random() * patients.length)];
    emit('PATIENT_ADMITTED', { ...p, status: 'admitted' });
  }, randomBetween(30000, 90000)));

  // PATIENT_DISCHARGED — 45–120s
  intervals.push(setInterval(() => {
    const patients = getUnitPatients(unitId);
    if (patients.length === 0) return;
    const p = patients[Math.floor(Math.random() * patients.length)];
    emit('PATIENT_DISCHARGED', { patient_id: p.id, bed_id: p.bed_id ?? '', timestamp: new Date().toISOString() });
  }, randomBetween(45000, 120000)));

  // PATIENT_TRANSFERRED — 60–180s
  intervals.push(setInterval(() => {
    const patients = getUnitPatients(unitId);
    if (patients.length === 0) return;
    const p = patients[Math.floor(Math.random() * patients.length)];
    emit('PATIENT_TRANSFERRED', { patient_id: p.id, from_bed: p.bed_id ?? '', to_bed: 'N/A', to_unit: unitId });
  }, randomBetween(60000, 180000)));

  // ALERT_FIRED — 10–30s
  intervals.push(setInterval(() => {
    const alerts = getUnitAlerts(unitId);
    if (alerts.length === 0) return;
    const a = alerts[Math.floor(Math.random() * alerts.length)];
    emit('ALERT_FIRED', a);
  }, randomBetween(10000, 30000)));

  // ALERT_RESOLVED — 20–60s
  intervals.push(setInterval(() => {
    const alerts = getUnitAlerts(unitId);
    if (alerts.length === 0) return;
    const a = alerts[Math.floor(Math.random() * alerts.length)];
    emit('ALERT_RESOLVED', { alert_id: a.id, resolved_at: new Date().toISOString() });
  }, randomBetween(20000, 60000)));

  // TELEMETRY_SPIKE — 5–15s
  intervals.push(setInterval(() => {
    const patients = getUnitPatients(unitId).filter((p) => p.vitals.length > 0);
    if (patients.length === 0) return;
    const p = patients[Math.floor(Math.random() * patients.length)];
    const vitals = ['hr', 'spo2', 'bp_sys'];
    const vital = vitals[Math.floor(Math.random() * vitals.length)];
    emit('TELEMETRY_SPIKE', { patient_id: p.id, vital, value: Math.random() * 200, threshold: 120 });
  }, randomBetween(5000, 15000)));

  // STAFF_UPDATED — 60–120s
  intervals.push(setInterval(() => {
    const s = db.staff.filter((s) => s.unit_id === unitId);
    if (s.length === 0) return;
    const member = s[Math.floor(Math.random() * s.length)];
    emit('STAFF_UPDATED', member);
  }, randomBetween(60000, 120000)));

  req.on('close', () => {
    const idx = sseClients.indexOf(client);
    if (idx !== -1) sseClients.splice(idx, 1);
    for (const id of intervals) clearInterval(id);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 PulseOps mock server running at http://localhost:${PORT}`);
});
