// ─── Domain Types ─────────────────────────────────────────────────────────────

export interface Unit {
  id: string;
  name: string;
  type: 'cardiac' | 'neuro' | 'surgical' | 'icu' | 'peds' | 'oncology' | 'stepdown' | 'ed';
  floor: number;
  capacity: number;
  supervisor_id: string;
}

export type BedStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'blocked';

export interface Bed {
  id: string;
  unit_id: string;
  room: string;
  label: string;
  status: BedStatus;
  patient_id: string | null;
  isolation_type: 'contact' | 'droplet' | 'airborne' | null;
  telemetry_equipped: boolean;
  updated_at: string;
}

export type AcuityLevel = 1 | 2 | 3 | 4 | 5;
export type FallRisk = 'low' | 'moderate' | 'high';
export type CodeStatus = 'full' | 'dnr' | 'dni' | 'dnar';
export type PatientStatus =
  | 'admitted'
  | 'discharging'
  | 'transferred'
  | 'pending_admission'
  | 'observation';

export interface CareTeamMember {
  role: string;
  provider_id: string;
  name: string;
}

export type PatientFlagType =
  | 'fall_risk'
  | 'allergy'
  | 'isolation'
  | 'observation'
  | 'review'
  | 'critical';

export interface PatientFlag {
  type: PatientFlagType;
  label: string;
  acknowledged: boolean;
  created_at: string;
}

export interface VitalsEntry {
  timestamp: string;
  hr: number;
  bp_sys: number;
  bp_dia: number;
  spo2: number;
  temp_c: number;
  rr: number;
}

export interface NoteEntry {
  id: string;
  author: string;
  role: string;
  body: string;
  created_at: string;
}

export interface Patient {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  dob: string;
  unit_id: string;
  bed_id: string | null;
  acuity: AcuityLevel;
  status: PatientStatus;
  admitting_dx: string;
  chief_complaint: string;
  los_hours: number;
  expected_discharge: string | null;
  attending_provider_id: string | null;
  care_team: CareTeamMember[];
  flags: PatientFlag[];
  vitals: VitalsEntry[];
  notes: NoteEntry[];
  fall_risk: FallRisk;
  isolation_type: 'contact' | 'droplet' | 'airborne' | null;
  code_status: CodeStatus;
  etag: string;
  updated_at: string;
}

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  unit_id: string;
  patient_id: string | null;
  bed_id: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  unit_id: string;
  shift: 'day' | 'evening' | 'night';
  patient_ids: string[];
}

export interface CensusStats {
  by_acuity: Record<AcuityLevel, number>;
  by_status: Record<PatientStatus, number>;
  avg_los: number;
  patients_over_target_los: number;
  beds_available: number;
  nurse_ratio_violations: string[];
}

// ─── Filter & Sort ────────────────────────────────────────────────────────────

export interface FilterState {
  unit_ids: string[];
  status: PatientStatus[];
  acuity_min: AcuityLevel | null;
  acuity_max: AcuityLevel | null;
  search: string;
  fall_risk: FallRisk[];
  isolation_type: Array<'contact' | 'droplet' | 'airborne' | null>;
  code_status: CodeStatus[];
  attending_provider_id: string | null;
  los_gt_hours: number | null;
  flag_types: PatientFlagType[];
}

export type SortKey = 'name' | 'acuity' | 'los' | 'last_event';
export type SortDir = 'asc' | 'desc';

export interface SortColumn {
  key: SortKey;
  dir: SortDir;
}

export interface SortState {
  columns: SortColumn[];
}

export interface SavedView {
  id: string;
  name: string;
  unit_id: string;
  filters: FilterState;
  sort: SortState;
  layout: 'map' | 'log' | 'split';
  created_at: string;
}

// ─── SSE Types ────────────────────────────────────────────────────────────────

export type SSEEventType =
  | 'BED_STATUS_CHANGED'
  | 'PATIENT_ADMITTED'
  | 'PATIENT_DISCHARGED'
  | 'PATIENT_TRANSFERRED'
  | 'ALERT_FIRED'
  | 'ALERT_RESOLVED'
  | 'TELEMETRY_SPIKE'
  | 'STAFF_UPDATED'
  | 'HEARTBEAT';

export interface SSEEventPayload {
  BED_STATUS_CHANGED: { bed_id: string; new_status: Bed['status']; patient_id?: string };
  PATIENT_ADMITTED: Patient;
  PATIENT_DISCHARGED: { patient_id: string; bed_id: string; timestamp: string };
  PATIENT_TRANSFERRED: {
    patient_id: string;
    from_bed: string;
    to_bed: string;
    to_unit: string;
  };
  ALERT_FIRED: Alert;
  ALERT_RESOLVED: { alert_id: string; resolved_at: string };
  TELEMETRY_SPIKE: {
    patient_id: string;
    vital: string;
    value: number;
    threshold: number;
  };
  STAFF_UPDATED: StaffMember;
  HEARTBEAT: { server_time: string };
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

// ─── Worker Message Types ─────────────────────────────────────────────────────

export type WorkerInboundMessage =
  | { type: 'LOAD'; payload: Patient[] }
  | { type: 'FILTER'; payload: FilterState }
  | { type: 'SORT'; payload: SortState }
  | { type: 'AGGREGATE'; payload: { unit_ids: string[] } }
  | { type: 'COMPUTE_HANDOFF_LIST'; payload: { within_hours: number } };

export type WorkerOutboundMessage =
  | { type: 'RESULT'; payload: { indices: number[]; stats: CensusStats } }
  | { type: 'HANDOFF'; payload: { patient_ids: string[]; reasons: string[] } }
  | { type: 'ERROR'; payload: { message: string } };
