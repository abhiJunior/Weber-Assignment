import { useQuery } from '@tanstack/react-query';
import type { Unit } from '../types';



const BASE = 'http://localhost:3001/api/v1';

export function useUnits() {
  return useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/units`);
      if (!res.ok) throw new Error('Failed to fetch units');
      return res.json() as Promise<Unit[]>;
    },
  });
}
