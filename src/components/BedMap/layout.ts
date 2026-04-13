import type { Bed } from '../../types';

export interface LayoutConfig {
  roomsPerRow?: number;    // default 4
  roomWidth?: number;      // default 160
  bedsPerRow?: number;     // default 2
  bedWidth?: number;       // default 70
  bedHeight?: number;      // default 80
  gap?: number;            // default 12
  padding?: number;        // default 20
}

export interface BedLayout {
  bed_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  roomLabel: string;
  bedLabel: string;
}

export function computeBedLayout(beds: Bed[], config: LayoutConfig = {}): BedLayout[] {
  const {
    roomsPerRow = 4,
    roomWidth = 160,
    bedsPerRow = 2,
    bedWidth = 70,
    bedHeight = 80,
    gap = 12,
    padding = 20,
  } = config;

  // Room height derived from max rows of beds inside + header
  const headerHeight = 20;
  const bedsRowCount = 1; // assume 1 row of beds within each room
  const roomHeight = headerHeight + bedsRowCount * bedHeight + gap;
  const roomHSpacing = roomWidth + gap;
  const roomVSpacing = roomHeight + gap;

  // Group beds by room
  const roomMap = new Map<string, Bed[]>();
  for (const bed of beds) {
    const existing = roomMap.get(bed.room);
    if (existing) existing.push(bed);
    else roomMap.set(bed.room, [bed]);
  }

  // Sort rooms alphanumerically
  const sortedRooms = [...roomMap.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  const layouts: BedLayout[] = [];

  for (let roomIdx = 0; roomIdx < sortedRooms.length; roomIdx++) {
    const roomLabel = sortedRooms[roomIdx];
    const roomBeds = roomMap.get(roomLabel) ?? [];

    const roomCol = roomIdx % roomsPerRow;
    const roomRow = Math.floor(roomIdx / roomsPerRow);

    const roomX = padding + roomCol * roomHSpacing;
    const roomY = padding + roomRow * roomVSpacing;

    for (let bedIdx = 0; bedIdx < roomBeds.length; bedIdx++) {
      const bed = roomBeds[bedIdx];
      const bedSubCol = bedIdx % bedsPerRow;
      const bedSubRow = Math.floor(bedIdx / bedsPerRow);

      const bedX = roomX + bedSubCol * (bedWidth + gap / 2);
      const bedY = roomY + headerHeight + bedSubRow * (bedHeight + gap / 2);

      layouts.push({
        bed_id: bed.id,
        x: bedX,
        y: bedY,
        width: bedWidth,
        height: bedHeight,
        roomLabel,
        bedLabel: bed.label,
      });
    }
  }

  return layouts;
}
