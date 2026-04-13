import { useQuery } from '@tanstack/react-query';
import type { Alert } from '../types';

const BASE = 'http://localhost:3001/api/v1';

export function useAlerts(unitId: string | null) {
  return useQuery<Alert[]>({
    queryKey: ['alerts', unitId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (unitId) params.set('unit_id', unitId);
      const res = await fetch(`${BASE}/alerts?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch alerts');
      return res.json() as Promise<Alert[]>;
    },
    enabled: !!unitId,
  });
}
