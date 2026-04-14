import { create } from 'zustand';
import type { Alert } from '../types';


interface AlertSlice {
  alerts: Alert[];
  pendingAckIds: Set<string>;
  muted: boolean;
  addAlert: (alert: Alert) => void;
  resolveAlert: (alertId: string, resolvedAt: string) => void;
  setPendingAck: (alertId: string) => void;
  confirmAck: (alertId: string) => void;
  revertAck: (alertId: string) => void;
  toggleMuted: () => void;
  setAlerts: (alerts: Alert[]) => void;
}

export const useAlertStore = create<AlertSlice>((set) => ({
  alerts: [],
  pendingAckIds: new Set(),
  muted: false,
  addAlert: (alert) =>
    set((state) => {
      const existing = state.alerts.findIndex((a) => a.id === alert.id);
      if (existing !== -1) {
        const updated = [...state.alerts];
        updated[existing] = alert;
        return { alerts: updated };
      }
      return { alerts: [alert, ...state.alerts] };
    }),
  resolveAlert: (alertId, resolvedAt) =>
    set((state) => ({
      alerts: state.alerts.map((a) =>
        a.id === alertId ? { ...a, status: 'resolved', resolved_at: resolvedAt } : a
      ),
    })),
  setPendingAck: (alertId) =>
    set((state) => {
      const next = new Set(state.pendingAckIds);
      next.add(alertId);
      return { pendingAckIds: next };
    }),
  confirmAck: (alertId) =>
    set((state) => {
      const next = new Set(state.pendingAckIds);
      next.delete(alertId);
      return {
        pendingAckIds: next,
        alerts: state.alerts.map((a) =>
          a.id === alertId
            ? { ...a, status: 'acknowledged', acknowledged_at: new Date().toISOString() }
            : a
        ),
      };
    }),
  revertAck: (alertId) =>
    set((state) => {
      const next = new Set(state.pendingAckIds);
      next.delete(alertId);
      return { pendingAckIds: next };
    }),
  toggleMuted: () => set((state) => ({ muted: !state.muted })),
  setAlerts: (alerts) => set({ alerts }),
}));
