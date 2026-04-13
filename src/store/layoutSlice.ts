import { create } from 'zustand';

type LayoutMode = 'map' | 'log' | 'split';

interface LayoutSlice {
  layout: LayoutMode;
  zoomLevel: number;
  expandedPanels: string[];
  isOffline: boolean;
  offlineSince: string | null;
  setLayout: (layout: LayoutMode) => void;
  setZoom: (zoom: number) => void;
  togglePanel: (panelId: string) => void;
  setOffline: (isOffline: boolean, timestamp?: string) => void;
}

export const useLayoutStore = create<LayoutSlice>((set) => ({
  layout: 'split',
  zoomLevel: 1,
  expandedPanels: ['bedmap', 'patientlog', 'alertpanel'],
  isOffline: false,
  offlineSince: null,
  setLayout: (layout) => set({ layout }),
  setZoom: (zoomLevel) => set({ zoomLevel }),
  togglePanel: (panelId) =>
    set((state) => ({
      expandedPanels: state.expandedPanels.includes(panelId)
        ? state.expandedPanels.filter((p) => p !== panelId)
        : [...state.expandedPanels, panelId],
    })),
  setOffline: (isOffline, timestamp) =>
    set({
      isOffline,
      offlineSince: isOffline ? (timestamp ?? new Date().toISOString()) : null,
    }),
}));
