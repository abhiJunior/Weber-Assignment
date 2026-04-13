import { create } from 'zustand';
import type { Bed } from '../types';

interface BedSlice {
  beds: Bed[];
  selectedBedId: string | null;
  setBeds: (beds: Bed[]) => void;
  setSelectedBedId: (id: string | null) => void;
  updateBed: (bed: Bed) => void;
}

export const useBedStore = create<BedSlice>((set) => ({
  beds: [],
  selectedBedId: null,
  setBeds: (beds) => set({ beds }),
  setSelectedBedId: (selectedBedId) => set({ selectedBedId }),
  updateBed: (bed) =>
    set((state) => {
      const idx = state.beds.findIndex((b) => b.id === bed.id);
      if (idx === -1) return { beds: [...state.beds, bed] };
      const next = [...state.beds];
      next[idx] = bed;
      return { beds: next };
    }),
}));
