import { useQuery } from '@tanstack/react-query';
import type { Patient } from '../types';


const BASE = 'http://localhost:3001/api/v1';

export function usePatient(patientId: string | null) {
  return useQuery<Patient>({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/patients/${patientId}`);
      if (!res.ok) throw new Error('Failed to fetch patient');
      return res.json() as Promise<Patient>;
    },
    enabled: !!patientId,
  });
}
