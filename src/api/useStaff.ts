import { useQuery } from '@tanstack/react-query';
import type { StaffMember } from '../types';


const BASE = 'http://localhost:3001/api/v1';

export function useStaff(unitId: string | null) {
  return useQuery<StaffMember[]>({
    queryKey: ['staff', unitId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (unitId) params.set('unit_id', unitId);
      const res = await fetch(`${BASE}/staff?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch staff');
      return res.json() as Promise<StaffMember[]>;
    },
    enabled: !!unitId,
  });
}
