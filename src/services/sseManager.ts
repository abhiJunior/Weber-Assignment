import type {
  SSEEventType,
  SSEEventPayload,
  ConnectionState,
  Bed,
} from '../types';

type Handler<T extends SSEEventType> = (payload: SSEEventPayload[T]) => void;

interface QueuedEvent {
  type: SSEEventType;
  payload: SSEEventPayload[SSEEventType];
  bed_id?: string;
  ts: number;
}

// ─── SSEManager ───────────────────────────────────────────────────────────────
export class SSEManager {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private currentUnitId: string | null = null;
  private connectionState: ConnectionState = 'connecting';

  // Subscribers
  private handlers: Map<SSEEventType, Set<Handler<SSEEventType>>> = new Map();
  private stateListeners: Set<(state: ConnectionState) => void> = new Set();

  // Reconnect backoff
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat watchdog
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WATCHDOG_MS = 15_000;

  // Local bed state for catch-up merging
  private localBeds: Map<string, Bed> = new Map();

  // Event queue for deduplication on reconnect
  private eventQueue: QueuedEvent[] = [];
  private readonly MAX_QUEUE = 200;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  connect(unitId: string): void {
    if (this.eventSource) this.eventSource.close();
    this.currentUnitId = unitId;
    this.reconnectAttempt = 0;
    this._openConnection();
  }

  disconnect(): void {
    this._clearTimers();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._setState('offline');
  }

  subscribe<T extends SSEEventType>(
    type: T,
    handler: (payload: SSEEventPayload[T]) => void
  ): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    const castHandler = handler as Handler<SSEEventType>;
    this.handlers.get(type)!.add(castHandler);
    return () => this.handlers.get(type)?.delete(castHandler);
  }

  onStateChange(cb: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  // ─── Private ─────────────────────────────────────────────────────────────────
  private _openConnection(): void {
    if (!this.currentUnitId) return;
    this._setState('connecting');

    const url = `${this.baseUrl}/stream?unit_id=${this.currentUnitId}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (ev: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(ev.data) as { type: SSEEventType; payload: SSEEventPayload[SSEEventType] };
        this._handleEvent(parsed.type, parsed.payload);
      } catch {
        // malformed event — ignore
      }
    };

    this.eventSource.onerror = () => {
      this._scheduleReconnect();
    };
  }

  private _handleEvent(type: SSEEventType, payload: SSEEventPayload[SSEEventType]): void {
    if (this.connectionState !== 'connected') this._setState('connected');

    if (type === 'HEARTBEAT') {
      this._resetWatchdog();
    } else {
      this._resetWatchdog();
      // Cache to queue
      const bedId =
        'bed_id' in (payload as Record<string, unknown>)
          ? (payload as Record<string, unknown>).bed_id as string
          : undefined;
      this._enqueue({ type, payload, bed_id: bedId, ts: Date.now() });

      // Update local bed state for BED_STATUS_CHANGED
      if (type === 'BED_STATUS_CHANGED') {
        const p = payload as SSEEventPayload['BED_STATUS_CHANGED'];
        const existing = this.localBeds.get(p.bed_id);
        if (existing) {
          this.localBeds.set(p.bed_id, {
            ...existing,
            status: p.new_status,
            patient_id: p.patient_id ?? null,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    // Dispatch to subscribers
    const typedHandlers = this.handlers.get(type);
    if (typedHandlers) {
      for (const handler of typedHandlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[SSEManager] Handler error for ${type}:`, err);
        }
      }
    }
  }

  private _resetWatchdog(): void {
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      console.warn('[SSEManager] Heartbeat watchdog fired — reconnecting');
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      this._scheduleReconnect();
    }, this.WATCHDOG_MS);
  }

  private _scheduleReconnect(): void {
    this._setState('reconnecting');
    this.reconnectAttempt++;
    const baseDelay = Math.min(Math.pow(2, this.reconnectAttempt - 1) * 1000, 30_000);
    const jitter = baseDelay * (0.75 + Math.random() * 0.5);
    const delay = Math.round(jitter);

    this.reconnectTimer = setTimeout(() => {
      void this._reconnect();
    }, delay);
  }

  private async _reconnect(): Promise<void> {
    if (!this.currentUnitId) return;

    // Fetch fresh census
    try {
      const res = await fetch(`${this.baseUrl}/units/${this.currentUnitId}/census`);
      if (res.ok) {
        const data = (await res.json()) as { beds?: Bed[] };
        if (data.beds) {
          for (const serverBed of data.beds) {
            const local = this.localBeds.get(serverBed.id);
            if (!local || new Date(serverBed.updated_at) > new Date(local.updated_at)) {
              // Server is newer — merge and emit synthetic event
              if (local && local.status !== serverBed.status) {
                this._handleEvent('BED_STATUS_CHANGED', {
                  bed_id: serverBed.id,
                  new_status: serverBed.status,
                  patient_id: serverBed.patient_id ?? undefined,
                });
              }
              this.localBeds.set(serverBed.id, serverBed);
            }
            // else: local is newer — keep local, no event
          }
        }
      }
    } catch {
      // network error — proceed with reconnect anyway
    }

    // Replay deduplicated queue
    this._replayQueue();
    this._openConnection();
  }

  private _enqueue(event: QueuedEvent): void {
    this.eventQueue.push(event);
    if (this.eventQueue.length > this.MAX_QUEUE) this.eventQueue.shift();
  }

  private _replayQueue(): void {
    // Deduplicate: keep only latest per (bed_id, type)
    const seen = new Map<string, QueuedEvent>();
    for (const ev of this.eventQueue) {
      const key = `${ev.bed_id ?? '__none__'}:${ev.type}`;
      const existing = seen.get(key);
      if (!existing || ev.ts > existing.ts) seen.set(key, ev);
    }
    for (const ev of seen.values()) {
      this._dispatch(ev.type, ev.payload);
    }
    this.eventQueue = [];
  }

  private _dispatch(type: SSEEventType, payload: SSEEventPayload[SSEEventType]): void {
    const typedHandlers = this.handlers.get(type);
    if (!typedHandlers) return;
    for (const handler of typedHandlers) {
      try { handler(payload); } catch (err) { console.error('[SSEManager]', err); }
    }
  }

  private _setState(state: ConnectionState): void {
    this.connectionState = state;
    for (const cb of this.stateListeners) {
      try { cb(state); } catch { /* ignore */ }
    }
  }

  private _clearTimers(): void {
    if (this.watchdogTimer !== null) { clearTimeout(this.watchdogTimer); this.watchdogTimer = null; }
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  // Expose for testing
  get _queuedEventCount(): number { return this.eventQueue.length; }
  get _state(): ConnectionState { return this.connectionState; }
}

export const sseManager = new SSEManager('http://localhost:3001/api/v1');
