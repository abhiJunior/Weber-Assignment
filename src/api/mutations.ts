import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Patient } from '../types';
import { useBedStore } from '../store/bedSlice';

const BASE = 'http://localhost:3001/api/v1';

// ─── Toast (simple alert fallback) ───────────────────────────────────────────
function toast(msg: string) {
  // In a real app, this would use a toast library
  console.info('[Toast]', msg);
}

// ─── Admit ────────────────────────────────────────────────────────────────────
interface AdmitPayload {
  patientId: string;
  etag: string;
  bedId: string;
  unitId: string;
}

interface ConflictError {
  type: 'conflict';
  current_etag: string;
  current_state: Patient;
}

export function useMutateAdmit() {
  const qc = useQueryClient();
  const updateBed = useBedStore((s) => s.updateBed);

  return useMutation<Patient, ConflictError | Error, AdmitPayload>({
    mutationFn: async ({ patientId, etag, bedId, unitId }) => {
      const res = await fetch(`${BASE}/patients/${patientId}/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({ bed_id: bedId, unit_id: unitId }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { error: string; current_etag: string; current_state: Patient };
        const err: ConflictError = { type: 'conflict', current_etag: body.current_etag, current_state: body.current_state };
        throw err;
      }
      if (!res.ok) throw new Error('Admit failed');
      return res.json() as Promise<Patient>;
    },
    onSuccess: (patient) => {
      void qc.invalidateQueries({ queryKey: ['patients'] });
      void qc.setQueryData(['patient', patient.id], patient);
      // Update bed status in store
      const currentBed = useBedStore.getState().beds.find((b) => b.id === patient.bed_id);
      if (currentBed) {
        updateBed({ ...currentBed, status: 'occupied', patient_id: patient.id });
      }
      toast(`Patient ${patient.first_name} ${patient.last_name} admitted successfully`);
    },
    onError: (err) => {
      if ('type' in err && err.type === 'conflict') {
        toast(`Conflict: Another user updated this patient. Please review the current state.`);
      } else {
        toast('Admit failed. Please try again.');
      }
    },
  });
}

// ─── Discharge ────────────────────────────────────────────────────────────────
interface DischargePayload { patientId: string }

export function useMutateDischarge() {
  const qc = useQueryClient();
  return useMutation<Patient, Error, DischargePayload>({
    mutationFn: async ({ patientId }) => {
      const res = await fetch(`${BASE}/patients/${patientId}/discharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Discharge failed');
      return res.json() as Promise<Patient>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patients'] });
      toast('Patient discharged successfully');
    },
    onError: () => toast('Discharge failed. Please try again.'),
  });
}

// ─── Transfer ─────────────────────────────────────────────────────────────────
interface TransferPayload { patientId: string; toBedId: string; toUnitId: string }

export function useMutateTransfer() {
  const qc = useQueryClient();
  return useMutation<Patient, Error, TransferPayload>({
    mutationFn: async ({ patientId, toBedId, toUnitId }) => {
      const res = await fetch(`${BASE}/patients/${patientId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_bed_id: toBedId, to_unit_id: toUnitId }),
      });
      if (!res.ok) throw new Error('Transfer failed');
      return res.json() as Promise<Patient>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patients'] });
      toast('Patient transferred successfully');
    },
    onError: () => toast('Transfer failed. Please try again.'),
  });
}

// ─── Acknowledge Alert ────────────────────────────────────────────────────────
interface AckPayload { alertId: string }

export function useMutateAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation<void, Error, AckPayload>({
    mutationFn: async ({ alertId }) => {
      const res = await fetch(`${BASE}/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Acknowledge failed');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: () => toast('Failed to acknowledge alert.'),
  });
}
