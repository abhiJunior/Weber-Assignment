import type {
  Patient,
  FilterState,
  SortState,
  CensusStats,
  AcuityLevel,
  PatientStatus,
} from '../types';

// ─── State ────────────────────────────────────────────────────────────────────
let patients: Patient[] = [];
let currentFilter: FilterState | null = null;
let currentSort: SortState | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function computeStats(filtered: Patient[]): CensusStats {
  const by_acuity: Record<AcuityLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const by_status: Record<PatientStatus, number> = {
    admitted: 0,
    discharging: 0,
    transferred: 0,
    pending_admission: 0,
    observation: 0,
  };
  let total_los = 0;
  let over_target = 0;
  let beds_available = 0;

  for (const p of filtered) {
    by_acuity[p.acuity] = (by_acuity[p.acuity] ?? 0) + 1;
    by_status[p.status] = (by_status[p.status] ?? 0) + 1;
    total_los += p.los_hours;
    if (p.los_hours > 72) over_target++;
    if (p.bed_id === null) beds_available++;
  }

  return {
    by_acuity,
    by_status,
    avg_los: filtered.length > 0 ? total_los / filtered.length : 0,
    patients_over_target_los: over_target,
    beds_available,
    nurse_ratio_violations: [],
  };
}

function applyFilter(pts: Patient[], filter: FilterState): Patient[] {
  return pts.filter((p) => {
    if (filter.unit_ids.length > 0 && !filter.unit_ids.includes(p.unit_id)) return false;
    if (filter.status.length > 0 && !filter.status.includes(p.status)) return false;
    if (filter.acuity_min != null && p.acuity < filter.acuity_min) return false;
    if (filter.acuity_max != null && p.acuity > filter.acuity_max) return false;
    if (filter.fall_risk.length > 0 && !filter.fall_risk.includes(p.fall_risk)) return false;
    if (filter.isolation_type.length > 0) {
      const hasMatch = filter.isolation_type.some((it) => it === p.isolation_type);
      if (!hasMatch) return false;
    }
    if (filter.code_status.length > 0 && !filter.code_status.includes(p.code_status)) return false;
    if (
      filter.attending_provider_id != null &&
      p.attending_provider_id !== filter.attending_provider_id
    )
      return false;
    if (filter.los_gt_hours != null && p.los_hours <= filter.los_gt_hours) return false;
    if (filter.flag_types.length > 0) {
      const hasFlag = filter.flag_types.some((ft) => p.flags.some((f) => f.type === ft));
      if (!hasFlag) return false;
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      if (
        !fullName.includes(q) &&
        !p.mrn.toLowerCase().includes(q) &&
        !p.chief_complaint.toLowerCase().includes(q) &&
        !p.admitting_dx.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

function applySort(pts: Patient[], sort: SortState): Patient[] {
  const cols = sort.columns.slice(0, 3);
  return [...pts].sort((a, b) => {
    for (const col of cols) {
      let cmp = 0;
      switch (col.key) {
        case 'name':
          cmp = `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`);
          break;
        case 'acuity':
          cmp = a.acuity - b.acuity;
          break;
        case 'los':
          cmp = a.los_hours - b.los_hours;
          break;
        case 'last_event':
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
      }
      if (cmp !== 0) return col.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function runFilterAndSort() {
  try {
    let filtered = patients;
    if (currentFilter) filtered = applyFilter(filtered, currentFilter);
    if (currentSort) filtered = applySort(filtered, currentSort);

    const indices = filtered.map((p) => patients.indexOf(p));
    const stats = computeStats(filtered);

    self.postMessage({ type: 'RESULT', payload: { indices, stats } });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err instanceof Error ? err.message : 'Unknown worker error' },
    });
  }
}

function scheduleRun() {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runFilterAndSort();
  }, 100);
}

// ─── Message Handler ──────────────────────────────────────────────────────────
self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: string; payload: unknown };

  switch (msg.type) {
    case 'LOAD':
      patients = msg.payload as Patient[];
      runFilterAndSort();
      break;

    case 'FILTER':
      currentFilter = msg.payload as FilterState;
      scheduleRun();
      break;

    case 'SORT':
      currentSort = msg.payload as SortState;
      scheduleRun();
      break;

    case 'AGGREGATE': {
      const { unit_ids } = msg.payload as { unit_ids: string[] };
      const filtered = unit_ids.length > 0
        ? patients.filter((p) => unit_ids.includes(p.unit_id))
        : patients;
      const stats = computeStats(filtered);
      const indices = filtered.map((p) => patients.indexOf(p));
      self.postMessage({ type: 'RESULT', payload: { indices, stats } });
      break;
    }

    case 'COMPUTE_HANDOFF_LIST': {
      const { within_hours } = msg.payload as { within_hours: number };
      const now = Date.now();
      const windowMs = within_hours * 3600 * 1000;
      const eligible = patients.filter((p) => {
        if (p.status === 'discharging') return false;
        const soonDischarge =
          p.expected_discharge != null &&
          new Date(p.expected_discharge).getTime() - now <= windowMs;
        const highAcuityLong = p.acuity >= 4 && p.los_hours > 48;
        return soonDischarge || highAcuityLong;
      });

      const patient_ids = eligible.map((p) => p.id);
      const reasons = eligible.map((p) => {
        const r: string[] = [];
        if (
          p.expected_discharge != null &&
          new Date(p.expected_discharge).getTime() - now <= windowMs
        )
          r.push(`Expected discharge within ${within_hours}h`);
        if (p.acuity >= 4 && p.los_hours > 48)
          r.push(`High acuity (${p.acuity}) with LOS > 48h`);
        return r.join('; ');
      });

      self.postMessage({ type: 'HANDOFF', payload: { patient_ids, reasons } });
      break;
    }

    default:
      self.postMessage({
        type: 'ERROR',
        payload: { message: `Unknown message type: ${msg.type}` },
      });
  }
};
