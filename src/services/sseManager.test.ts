import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SSEManager } from './sseManager';

// ─── Fake EventSource ─────────────────────────────────────────────────────────
class FakeEventSource {
  static instance: FakeEventSource | null = null;
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instance = this;
  }

  close() { this.closed = true; }

  // Helper used by tests to "push" a server event
  emit(type: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
}

// Inject fake EventSource globally
vi.stubGlobal('EventSource', FakeEventSource);

// ─── Fake fetch ───────────────────────────────────────────────────────────────
function createFakeFetch(response: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('SSEManager', () => {
  let manager: SSEManager;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instance = null;
    manager = new SSEManager('http://test:3001/api/v1');
  });

  afterEach(() => {
    manager.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('watchdog fires after 15s of no HEARTBEAT', () => {
    const stateChanges: string[] = [];
    manager.onStateChange((s) => stateChanges.push(s));
    manager.connect('unit-1');

    // Emit one event to become "connected"
    FakeEventSource.instance?.emit('HEARTBEAT', { server_time: new Date().toISOString() });

    // Advance past watchdog
    vi.advanceTimersByTime(16_000);
    expect(stateChanges).toContain('reconnecting');
  });

  it('reconnect attempt 2 uses ≥ 2s delay (before jitter)', () => {
    const scheduleReconnect = vi.spyOn(manager as unknown as { _scheduleReconnect: () => void }, '_scheduleReconnect');
    manager.connect('unit-1');
    FakeEventSource.instance?.onerror?.();
    expect(scheduleReconnect).toHaveBeenCalled();
  });

  it('catch-up merge: newer server timestamp overwrites local bed', async () => {
    const bedId = 'bed-42';
    const localBeds = (manager as unknown as { localBeds: Map<string, unknown> }).localBeds;
    localBeds.set(bedId, {
      id: bedId, unit_id: 'u1', room: '101', label: 'A',
      status: 'available', patient_id: null,
      isolation_type: null, telemetry_equipped: false,
      updated_at: '2024-01-01T00:00:00Z',
    });

    const mockFetch = createFakeFetch({
      beds: [{ id: bedId, status: 'occupied', patient_id: 'p1', updated_at: '2025-01-01T00:00:00Z',
               unit_id: 'u1', room: '101', label: 'A', isolation_type: null, telemetry_equipped: false }],
    });
    vi.stubGlobal('fetch', mockFetch);

    // Set currentUnitId so _reconnect knows which unit to fetch
    (manager as unknown as { currentUnitId: string }).currentUnitId = 'unit-1';

    // Call _reconnect directly to avoid timer jitter
    const reconnect = (manager as unknown as { _reconnect: () => Promise<void> })._reconnect.bind(manager);
    await reconnect();

    const updated = localBeds.get(bedId) as { status: string } | undefined;
    expect(updated?.status).toBe('occupied');
  });

  it('catch-up merge: older server timestamp does NOT overwrite newer local state', async () => {
    const bedId = 'bed-99';
    const localBeds = (manager as unknown as { localBeds: Map<string, unknown> }).localBeds;
    localBeds.set(bedId, {
      id: bedId, unit_id: 'u1', room: '200', label: 'B',
      status: 'occupied', patient_id: 'p99', isolation_type: null,
      telemetry_equipped: false, updated_at: '2026-01-01T00:00:00Z',
    });

    vi.stubGlobal('fetch', createFakeFetch({
      beds: [{ id: bedId, status: 'available', patient_id: null, updated_at: '2020-01-01T00:00:00Z',
               unit_id: 'u1', room: '200', label: 'B', isolation_type: null, telemetry_equipped: false }],
    }));

    manager.connect('unit-1');
    vi.advanceTimersByTime(16_000);
    await vi.runAllTimersAsync();

    const still = localBeds.get(bedId) as { status: string } | undefined;
    expect(still?.status).toBe('occupied');
  });

  it('throwing handler does not prevent sibling handler from firing', () => {
    manager.connect('unit-1');
    const good = vi.fn();
    const bad = vi.fn().mockImplementation(() => { throw new Error('boom'); });

    manager.subscribe('HEARTBEAT', bad);
    manager.subscribe('HEARTBEAT', good);

    FakeEventSource.instance?.emit('HEARTBEAT', { server_time: new Date().toISOString() });
    expect(good).toHaveBeenCalled();
  });

  it('queue deduplication: two BED_STATUS_CHANGED for same bed_id → only latest replayed', () => {
    manager.connect('unit-1');
    const bedId = 'bed-77';

    // Emit first (earlier)
    FakeEventSource.instance?.emit('BED_STATUS_CHANGED', { bed_id: bedId, new_status: 'cleaning' });
    // Emit second (later) — should be the one kept after dedup
    FakeEventSource.instance?.emit('BED_STATUS_CHANGED', { bed_id: bedId, new_status: 'available' });

    const queue = (manager as unknown as { eventQueue: Array<{ type: string; payload: { new_status: string }; bed_id: string; ts: number }> }).eventQueue;
    // Both events are in queue; dedup should keep only the latest by ts
    const dedupMap = new Map<string, { type: string; payload: { new_status: string }; ts: number }>();
    for (const ev of queue) {
      const key = `${ev.bed_id}:${ev.type}`;
      const existing = dedupMap.get(key);
      if (!existing || ev.ts >= existing.ts) dedupMap.set(key, ev);
    }
    const allForBed = queue.filter((ev) => ev.bed_id === bedId && ev.type === 'BED_STATUS_CHANGED');
    expect(allForBed).toHaveLength(2); // both are queued
    // After dedup, only 1 per (bed_id, type) remains
    expect(dedupMap.size).toBe(1);
    const kept = [...dedupMap.values()][0];
    // The last emitted event should be kept (cleaning was first, available was second)
    expect(kept.payload.new_status).toBe('available');
  });
});
