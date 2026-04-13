import { describe, it, expect } from 'vitest';
import { computeBedLayout } from './layout';
import type { Bed } from '../../types';

function makeBed(room: string, label: string): Bed {
  return {
    id: `${room}-${label}`,
    unit_id: 'u1',
    room,
    label,
    status: 'available',
    patient_id: null,
    isolation_type: null,
    telemetry_equipped: false,
    updated_at: new Date().toISOString(),
  };
}

describe('computeBedLayout', () => {
  it('produces one layout per bed', () => {
    const beds = [
      makeBed('101', 'A'), makeBed('101', 'B'),
      makeBed('102', 'A'), makeBed('102', 'B'),
      makeBed('103', 'A'), makeBed('103', 'B'),
    ];
    const layouts = computeBedLayout(beds);
    expect(layouts).toHaveLength(6);
  });

  it('12 beds in 3 rooms → beds in room 2 are offset right by roomWidth+gap', () => {
    const beds: Bed[] = [];
    for (let r = 1; r <= 3; r++) {
      beds.push(makeBed(`Room${r}`, 'A'), makeBed(`Room${r}`, 'B'),
                makeBed(`Room${r}`, 'C'), makeBed(`Room${r}`, 'D'));
    }
    const cfg = { roomsPerRow: 4, roomWidth: 160, bedsPerRow: 2, bedWidth: 70, bedHeight: 80, gap: 12, padding: 20 };
    const layouts = computeBedLayout(beds, cfg);

    // Room1 col=0, Room2 col=1, Room3 col=2
    const room1bed = layouts.find((l) => l.roomLabel === 'Room1' && l.bedLabel === 'A')!;
    const room2bed = layouts.find((l) => l.roomLabel === 'Room2' && l.bedLabel === 'A')!;

    const expectedXDiff = cfg.roomWidth + cfg.gap;
    expect(room2bed.x - room1bed.x).toBe(expectedXDiff);
  });

  it('rooms wrap to next row after roomsPerRow', () => {
    const beds: Bed[] = [];
    for (let r = 1; r <= 5; r++) beds.push(makeBed(`R${r}`, 'A'));
    const layouts = computeBedLayout(beds, { roomsPerRow: 4 });
    // R5 is in second row → its y should be greater than R1
    const r1 = layouts.find((l) => l.roomLabel === 'R1')!;
    const r5 = layouts.find((l) => l.roomLabel === 'R5')!;
    expect(r5.y).toBeGreaterThan(r1.y);
  });

  it('beds within same room are offset horizontally', () => {
    const beds = [makeBed('101', 'A'), makeBed('101', 'B')];
    const layouts = computeBedLayout(beds, { bedsPerRow: 2 });
    const a = layouts.find((l) => l.bedLabel === 'A')!;
    const b = layouts.find((l) => l.bedLabel === 'B')!;
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBe(a.y); // same row
  });

  it('all positions are non-negative', () => {
    const beds = Array.from({ length: 12 }, (_, i) => makeBed(`Room${Math.floor(i / 2) + 1}`, i % 2 === 0 ? 'A' : 'B'));
    const layouts = computeBedLayout(beds);
    for (const l of layouts) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('each layout has correct bed_id', () => {
    const beds = [makeBed('201', 'A'), makeBed('202', 'A')];
    const layouts = computeBedLayout(beds);
    const ids = layouts.map((l) => l.bed_id);
    expect(ids).toContain('201-A');
    expect(ids).toContain('202-A');
  });
});
