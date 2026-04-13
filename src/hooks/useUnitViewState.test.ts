import { describe, it, expect } from 'vitest';
import type { FilterState, SortState } from '../types';

// ─── Helpers (inline from hook) ─────────────────────────────────────────────
function encodeB64url(v: unknown): string {
  return btoa(JSON.stringify(v))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function decodeB64url(s: string): unknown {
  return JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('useUnitViewState — base64url codec', () => {
  const fullFilter: FilterState = {
    unit_ids: ['unit-1', 'unit-2'],
    status: ['admitted', 'observation'],
    acuity_min: 2,
    acuity_max: 4,
    search: 'alice',
    fall_risk: ['high'],
    isolation_type: ['contact', null],
    code_status: ['dnr'],
    attending_provider_id: 'prov-1',
    los_gt_hours: 48,
    flag_types: ['allergy'],
  };

  it('FilterState round-trips identically', () => {
    const encoded = encodeB64url(fullFilter);
    const decoded = decodeB64url(encoded) as FilterState;
    expect(decoded).toEqual(fullFilter);
  });

  it('empty arrays encode and decode correctly (not omitted)', () => {
    const f: FilterState = { ...fullFilter, status: [], flag_types: [] };
    const decoded = decodeB64url(encodeB64url(f)) as FilterState;
    expect(decoded.status).toEqual([]);
    expect(decoded.flag_types).toEqual([]);
  });

  it('unit_id with spaces and slashes round-trips', () => {
    const id = 'unit/a b/x';
    expect(decodeB64url(encodeB64url(id))).toBe(id);
  });

  it('null optional fields round-trip as null (not undefined)', () => {
    const f: FilterState = { ...fullFilter, acuity_min: null, attending_provider_id: null };
    const decoded = decodeB64url(encodeB64url(f)) as FilterState;
    expect(decoded.acuity_min).toBeNull();
    expect(decoded.attending_provider_id).toBeNull();
  });

  it('SortState with multiple columns round-trips', () => {
    const sort: SortState = {
      columns: [
        { key: 'acuity', dir: 'asc' },
        { key: 'los', dir: 'desc' },
      ],
    };
    expect(decodeB64url(encodeB64url(sort))).toEqual(sort);
  });

  it('encoded string uses only base64url-safe characters', () => {
    const encoded = encodeB64url(fullFilter);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});
