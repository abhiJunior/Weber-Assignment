import { create } from 'zustand';
import type { FilterState, SortState } from '../types';

const defaultFilters: FilterState = {
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

const defaultSort: SortState = {
  columns: [{ key: 'acuity', dir: 'asc' }],
};

interface FilterSlice {
  filters: FilterState;
  sort: SortState;
  setFilters: (filters: Partial<FilterState>) => void;
  setSort: (sort: SortState) => void;
  resetFilters: () => void;
}

export const useFilterStore = create<FilterSlice>((set) => ({
  filters: defaultFilters,
  sort: defaultSort,
  setFilters: (partial) =>
    set((state) => ({ filters: { ...state.filters, ...partial } })),
  setSort: (sort) => set({ sort }),
  resetFilters: () => set({ filters: defaultFilters, sort: defaultSort }),
}));

export { defaultFilters, defaultSort };
