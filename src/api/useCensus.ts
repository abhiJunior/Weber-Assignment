import { useQuery } from '@tanstack/react-query';
import type { CensusStats } from '../types';

const BASE = 'http://localhost:3001/api/v1';

export function useCensus(unitId: string | null) {
  return useQuery<CensusStats>({
    queryKey: ['census', unitId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/units/${unitId}/census`);
      if (!res.ok) throw new Error('Failed to fetch census');
      return res.json() as Promise<CensusStats>;
    },
    enabled: !!unitId,
  });
}
