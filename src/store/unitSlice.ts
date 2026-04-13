import { create } from 'zustand';
import type { Unit } from '../types';

interface UnitSlice {
  units: Unit[];
  selectedUnitId: string | null;
  setUnits: (units: Unit[]) => void;
  setSelectedUnitId: (id: string | null) => void;
}

export const useUnitStore = create<UnitSlice>((set) => ({
  units: [],
  selectedUnitId: null,
  setUnits: (units) => set({ units }),
  setSelectedUnitId: (selectedUnitId) => set({ selectedUnitId }),
}));
