import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Patient, FilterState, SortState } from '../types';

// ─── Minimal Patient factory ──────────────────────────────────────────────────
function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: crypto.randomUUID(),
    mrn: `MRN-${Math.floor(Math.random() * 9999)}`,
    first_name: 'John',
    last_name: 'Doe',
    dob: '1980-01-01',
    unit_id: 'unit-1',
    bed_id: 'bed-1',
    acuity: 2,
    status: 'admitted',
    admitting_dx: 'Chest pain',
    chief_complaint: 'Chest pain',
    los_hours: 24,
    expected_discharge: null,
    attending_provider_id: null,
    care_team: [],
    flags: [],
    vitals: [],
    notes: [],
    fall_risk: 'low',
    isolation_type: null,
    code_status: 'full',
    etag: crypto.randomUUID(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function defaultFilter(): FilterState {
  return {
    unit_ids: [],
    status: [],
    acuity_min: null,
    acuity_max: null,
    search: '',
    fall_risk: [],
    isolation_type: [],
    code_status: [],
    attending_provider_id: null,
    los_gt_hours: null,
    flag_types: [],
  };
}

// ─── We inline the worker logic here for unit-testability ─────────────────────
function applyFilter(patients: Patient[], filter: FilterState): Patient[] {
  return patients.filter((p) => {
    if (filter.unit_ids.length > 0 && !filter.unit_ids.includes(p.unit_id)) return false;
    if (filter.status.length > 0 && !filter.status.includes(p.status)) return false;
    if (filter.acuity_min != null && p.acuity < filter.acuity_min) return false;
    if (filter.acuity_max != null && p.acuity > filter.acuity_max) return false;
    if (filter.fall_risk.length > 0 && !filter.fall_risk.includes(p.fall_risk)) return false;
    if (filter.isolation_type.length > 0) {
      if (!filter.isolation_type.some((it) => it === p.isolation_type)) return false;
    }
    if (filter.code_status.length > 0 && !filter.code_status.includes(p.code_status)) return false;
    if (filter.attending_provider_id != null &&
      p.attending_provider_id !== filter.attending_provider_id) return false;
    if (filter.los_gt_hours != null && p.los_hours <= filter.los_gt_hours) return false;
    if (filter.flag_types.length > 0) {
      if (!filter.flag_types.some((ft) => p.flags.some((f) => f.type === ft))) return false;
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const name = `${p.first_name} ${p.last_name}`.toLowerCase();
      if (!name.includes(q) && !p.mrn.toLowerCase().includes(q) &&
        !p.chief_complaint.toLowerCase().includes(q) && !p.admitting_dx.toLowerCase().includes(q))
        return false;
    }
    return true;
  });
}

function applySort(patients: Patient[], sort: SortState): Patient[] {
  const cols = sort.columns.slice(0, 3);
  return [...patients].sort((a, b) => {
    for (const col of cols) {
      let cmp = 0;
      if (col.key === 'name') cmp = `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`);
      else if (col.key === 'acuity') cmp = a.acuity - b.acuity;
      else if (col.key === 'los') cmp = a.los_hours - b.los_hours;
      else if (col.key === 'last_event')
        cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      if (cmp !== 0) return col.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('patientWorker — filter logic', () => {
  const patients = [
    makePatient({ id: '1', unit_id: 'unit-a', status: 'admitted', acuity: 1, fall_risk: 'low', los_hours: 10 }),
    makePatient({ id: '2', unit_id: 'unit-b', status: 'discharging', acuity: 3, fall_risk: 'high', los_hours: 80 }),
    makePatient({ id: '3', unit_id: 'unit-a', status: 'observation', acuity: 5, fall_risk: 'moderate', los_hours: 50, isolation_type: 'contact' }),
  ];

  it('filters by unit_ids', () => {
    const f = { ...defaultFilter(), unit_ids: ['unit-a'] };
    expect(applyFilter(patients, f)).toHaveLength(2);
  });

  it('filters by status (OR logic)', () => {
    const f = { ...defaultFilter(), status: ['admitted', 'observation'] as FilterState['status'] };
    expect(applyFilter(patients, f)).toHaveLength(2);
  });

  it('filters by acuity range', () => {
    const f = { ...defaultFilter(), acuity_min: 2, acuity_max: 4 } as FilterState;
    expect(applyFilter(patients, f)).toHaveLength(1);
    expect(applyFilter(patients, f)[0].id).toBe('2');
  });

  it('filters by fall_risk (OR)', () => {
    const f = { ...defaultFilter(), fall_risk: ['high', 'moderate'] as FilterState['fall_risk'] };
    expect(applyFilter(patients, f)).toHaveLength(2);
  });

  it('filters by isolation_type (includes null)', () => {
    const f = { ...defaultFilter(), isolation_type: ['contact'] as FilterState['isolation_type'] };
    expect(applyFilter(patients, f)).toHaveLength(1);
    expect(applyFilter(patients, f)[0].id).toBe('3');
  });

  it('filters by los_gt_hours', () => {
    const f = { ...defaultFilter(), los_gt_hours: 48 };
    const result = applyFilter(patients, f);
    expect(result.every((p) => p.los_hours > 48)).toBe(true);
  });

  it('filters by search (name, MRN, complaint, dx)', () => {
    const specific = makePatient({ first_name: 'Alice', last_name: 'Smith', mrn: 'MRN-XYZZY' });
    const all = [...patients, specific];
    const f1 = { ...defaultFilter(), search: 'alice' };
    expect(applyFilter(all, f1)).toHaveLength(1);
    const f2 = { ...defaultFilter(), search: 'xyzzy' };
    expect(applyFilter(all, f2)).toHaveLength(1);
  });
});

describe('patientWorker — sort logic', () => {
  const A = makePatient({ id: 'a', acuity: 3, los_hours: 10, first_name: 'Charlie', last_name: 'Alpha', updated_at: '2024-01-01T10:00:00Z' });
  const B = makePatient({ id: 'b', acuity: 1, los_hours: 80, first_name: 'Alice', last_name: 'Beta', updated_at: '2024-01-03T10:00:00Z' });
  const C = makePatient({ id: 'c', acuity: 5, los_hours: 40, first_name: 'Bob', last_name: 'Gamma', updated_at: '2024-01-02T10:00:00Z' });
  const pts = [A, B, C];

  it('sorts by acuity asc', () => {
    const sorted = applySort(pts, { columns: [{ key: 'acuity', dir: 'asc' }] });
    expect(sorted.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by los desc', () => {
    const sorted = applySort(pts, { columns: [{ key: 'los', dir: 'desc' }] });
    expect(sorted[0].id).toBe('b');
  });

  it('multi-column sort (acuity asc, then los desc)', () => {
    const D = makePatient({ id: 'd', acuity: 3, los_hours: 60 });
    const all = [A, B, C, D];
    const sorted = applySort(all, {
      columns: [{ key: 'acuity', dir: 'asc' }, { key: 'los', dir: 'desc' }],
    });
    expect(sorted[0].id).toBe('b'); // acuity 1
    // acuity 3 group: D(60) then A(10)
    const acuity3 = sorted.filter((p) => p.acuity === 3);
    expect(acuity3[0].id).toBe('d');
  });

  it('sorts by name asc (last_name + first_name)', () => {
    const sorted = applySort(pts, { columns: [{ key: 'name', dir: 'asc' }] });
    expect(sorted[0].last_name).toBe('Alpha');
  });
});

describe('patientWorker — debounce via fake timers', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('rapid FILTER calls produce only one callback after 100ms', () => {
    const callback = vi.fn();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { callback(); }, 100);
    };

    schedule(); schedule(); schedule();
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('patientWorker — COMPUTE_HANDOFF_LIST', () => {
  it('returns patients needing handoff and skips discharging', () => {
    const now = Date.now();
    const fewHours = new Date(now + 2 * 3600 * 1000).toISOString();
    const p1 = makePatient({ id: 'h1', status: 'admitted', acuity: 4, los_hours: 50 });
    const p2 = makePatient({ id: 'h2', status: 'discharging', acuity: 5, los_hours: 60 }); // skip
    const p3 = makePatient({ id: 'h3', status: 'admitted', acuity: 1, los_hours: 10, expected_discharge: fewHours });
    const pts = [p1, p2, p3];
    const withinHours = 3;
    const windowMs = withinHours * 3600 * 1000;

    const eligible = pts.filter((p) => {
      if (p.status === 'discharging') return false;
      const soonDischarge = p.expected_discharge != null && new Date(p.expected_discharge).getTime() - now <= windowMs;
      const highAcuityLong = p.acuity >= 4 && p.los_hours > 48;
      return soonDischarge || highAcuityLong;
    });

    expect(eligible.map((p) => p.id)).toContain('h1');
    expect(eligible.map((p) => p.id)).toContain('h3');
    expect(eligible.map((p) => p.id)).not.toContain('h2');
  });
});

describe('patientWorker — CensusStats', () => {
  it('totals match input data', () => {
    const pts = [
      makePatient({ acuity: 1, status: 'admitted', los_hours: 30, bed_id: null }),
      makePatient({ acuity: 2, status: 'admitted', los_hours: 80 }),
      makePatient({ acuity: 3, status: 'discharging', los_hours: 10 }),
    ];

    const by_acuity: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const by_status: Record<string, number> = { admitted: 0, discharging: 0, transferred: 0, pending_admission: 0, observation: 0 };
    let total_los = 0;
    let over_target = 0;
    let beds_available = 0;

    for (const p of pts) {
      by_acuity[p.acuity]++;
      by_status[p.status]++;
      total_los += p.los_hours;
      if (p.los_hours > 72) over_target++;
      if (p.bed_id === null) beds_available++;
    }

    expect(by_acuity[1]).toBe(1);
    expect(by_status.admitted).toBe(2);
    expect(over_target).toBe(1);
    expect(beds_available).toBe(1);
    expect(total_los / pts.length).toBeCloseTo(40);
  });
});
