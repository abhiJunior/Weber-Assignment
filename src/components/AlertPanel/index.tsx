import { useState, useEffect, useRef, useCallback } from 'react';
import type { Alert } from '../../types';
import { useAlertStore } from '../../store/alertSlice';
import { useMutateAcknowledgeAlert } from '../../api/mutations';
import { SlideOver } from '../SlideOver';

// ─── Audio chime via Web Audio API ───────────────────────────────────────────
let audioCtx: AudioContext | null = null;

function initAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
}

function playCriticalChime() {
  if (!audioCtx) return;
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 440;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + 0.2);
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function relativeTime(iso: string, now: number): string {
  const diff = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function severityColor(s: Alert['severity']): string {
  switch (s) {
    case 'critical': return 'border-red-500 bg-red-950/40';
    case 'high': return 'border-orange-500 bg-orange-950/30';
    case 'medium': return 'border-yellow-500 bg-yellow-950/20';
    default: return 'border-slate-600 bg-slate-800/30';
  }
}

function severitySort(s: Alert['severity']): number {
  switch (s) { case 'critical': return 0; case 'high': return 1; case 'medium': return 2; default: return 3; }
}

// ─── Alert Row ────────────────────────────────────────────────────────────────
interface AlertRowProps {
  alert: Alert;
  isPending: boolean;
  currentTime: number;
  onAck: (id: string) => void;
}

function AlertRow({ alert, isPending, currentTime, onAck }: AlertRowProps) {
  const liveProps =
    alert.severity === 'critical'
      ? { role: 'alert' as const, 'aria-live': 'assertive' as const, 'aria-atomic': true }
      : { role: 'status' as const, 'aria-live': 'polite' as const, 'aria-atomic': true };

  return (
    <div
      {...liveProps}
      className={`rounded-xl border px-4 py-3 transition-opacity ${severityColor(alert.severity)} ${isPending ? 'opacity-50' : 'opacity-100'}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
              alert.severity === 'critical' ? 'bg-red-500 text-white' :
              alert.severity === 'high' ? 'bg-orange-500 text-white' :
              alert.severity === 'medium' ? 'bg-yellow-500 text-black' : 'bg-slate-500 text-white'
            }`}>
              {alert.severity}
            </span>
            <span className="text-xs text-slate-400">{relativeTime(alert.created_at, currentTime)}</span>
          </div>
          <p className="text-sm text-slate-200">{alert.message}</p>
        </div>
        {alert.status === 'active' && (
          <button
            onClick={() => onAck(alert.id)}
            disabled={isPending}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 transition"
          >
            {isPending ? 'Pending…' : 'Acknowledge'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── AlertPanel ───────────────────────────────────────────────────────────────
interface AlertPanelProps {
  unitId: string;
}

export function AlertPanel({ unitId }: AlertPanelProps) {
  const { alerts, pendingAckIds, muted, setPendingAck, confirmAck, revertAck, toggleMuted } = useAlertStore();
  const ackMutation = useMutateAcknowledgeAlert();

  // Single interval for all timestamps
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Audio init on first interaction
  useEffect(() => {
    window.addEventListener('click', initAudio, { once: true });
    return () => window.removeEventListener('click', initAudio);
  }, []);

  // Track previous alert count to detect new critical alerts
  const prevCriticalIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentCritical = alerts.filter((a) => a.severity === 'critical' && a.status === 'active');
    for (const a of currentCritical) {
      if (!prevCriticalIds.current.has(a.id) && !muted) {
        playCriticalChime();
      }
    }
    prevCriticalIds.current = new Set(currentCritical.map((a) => a.id));
  }, [alerts, muted]);

  // Filter to this unit & sort: critical first, oldest within tier
  const unitAlerts = alerts
    .filter((a) => a.unit_id === unitId && a.status !== 'resolved')
    .sort((a, b) => {
      const sc = severitySort(a.severity) - severitySort(b.severity);
      if (sc !== 0) return sc;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const handleAck = useCallback((alertId: string) => {
    setPendingAck(alertId);
    ackMutation.mutate(
      { alertId },
      {
        onSuccess: () => confirmAck(alertId),
        onError: () => revertAck(alertId),
      }
    );
  }, [setPendingAck, confirmAck, revertAck, ackMutation]);

  // History drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const PAGE_SIZE = 20;

  const acknowledged = alerts
    .filter((a) => a.unit_id === unitId && a.status === 'acknowledged')
    .filter((a) => a.message.toLowerCase().includes(historySearch.toLowerCase()))
    .sort((a, b) => new Date(b.acknowledged_at ?? '').getTime() - new Date(a.acknowledged_at ?? '').getTime());

  const historyPages = Math.max(1, Math.ceil(acknowledged.length / PAGE_SIZE));
  const pageItems = acknowledged.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);

  return (
    <section
      role="region"
      aria-label="Alert Panel"
      className="flex h-full flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">
          Alerts
          {unitAlerts.length > 0 && (
            <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold">{unitAlerts.length}</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMuted}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition ${muted ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-slate-400 hover:text-white'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
            aria-pressed={muted}
            aria-label="Toggle alert audio"
          >
            {muted ? '🔇 Muted' : '🔔 Live'}
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="rounded-lg px-3 py-1 text-xs font-medium text-slate-400 bg-white/10 hover:text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            View History
          </button>
        </div>
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto space-y-2 p-3">
        {unitAlerts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No active alerts for this unit
          </div>
        ) : (
          unitAlerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              isPending={pendingAckIds.has(alert.id)}
              currentTime={currentTime}
              onAck={handleAck}
            />
          ))
        )}
      </div>

      {/* History Drawer */}
      <SlideOver
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Alert History"
      >
        <div className="space-y-4">
          <input
            type="search"
            value={historySearch}
            onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(0); }}
            placeholder="Search alerts…"
            className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none ring-0 focus:ring-1 focus:ring-blue-500"
          />
          <div className="space-y-2">
            {pageItems.map((a) => (
              <div key={a.id} className="rounded-lg bg-white/5 px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase text-slate-400">{a.severity}</span>
                  <span className="text-xs text-slate-500">{a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleString() : ''}</span>
                </div>
                <p className="text-sm text-slate-300">{a.message}</p>
              </div>
            ))}
            {pageItems.length === 0 && <p className="text-sm text-slate-500">No results.</p>}
          </div>
          {historyPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                disabled={historyPage === 0}
                onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                className="rounded px-3 py-1 text-sm text-slate-400 bg-white/10 hover:bg-white/20 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-slate-500">Page {historyPage + 1} / {historyPages}</span>
              <button
                disabled={historyPage >= historyPages - 1}
                onClick={() => setHistoryPage((p) => Math.min(historyPages - 1, p + 1))}
                className="rounded px-3 py-1 text-sm text-slate-400 bg-white/10 hover:bg-white/20 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </SlideOver>
    </section>
  );
}
