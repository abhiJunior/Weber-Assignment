import { useQuery } from '@tanstack/react-query';
import type { Patient, FilterState, SortState } from '../types';


const BASE = 'http://localhost:3001/api/v1';

interface PatientsQuery {
  unitId?: string | null;
  filters?: Partial<FilterState>;
  sort?: SortState;
  page?: number;
  limit?: number;
}

export function usePatients(opts: PatientsQuery = {}) {
  const { unitId, filters, sort, page = 1, limit = 100 } = opts;
  return useQuery<Patient[]>({
    queryKey: ['patients', unitId, filters, sort, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (unitId) params.set('unit_id', unitId);
      if (filters?.status?.length) params.set('status', filters.status.join(','));
      if (filters?.acuity_min != null) params.set('acuity', String(filters.acuity_min));
      if (filters?.search) params.set('search', filters.search);
      if (sort?.columns[0]) {
        params.set('sort_by', sort.columns[0].key);
        params.set('sort_dir', sort.columns[0].dir);
      }
      params.set('page', String(page));
      params.set('limit', String(limit));
      const res = await fetch(`${BASE}/patients?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch patients');
      return res.json() as Promise<Patient[]>;
    },
    enabled: !!unitId,
  });
}
