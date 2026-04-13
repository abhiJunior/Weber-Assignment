import React, { useState, useCallback, useTransition, useDeferredValue, useReducer } from 'react';
import type { Patient, CensusStats, SortState, SortKey } from '../../types';
import { useVirtualScroll } from './useVirtualScroll';
import { useFilterStore } from '../../store/filterSlice';

const ROW_COLLAPSED = 44;
const ROW_EXPANDED = 140;

interface PatientLogProps {
  indices: number[];
  patients: Patient[];
  containerHeight: number;
  stats?: CensusStats | null;
}

// ─── PatientRow ───────────────────────────────────────────────────────────────
interface PatientRowProps {
  patient: Patient;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onAckFlag: (patientId: string, flagIdx: number) => void;
  style: React.CSSProperties;
}

function acuityBg(acuity: number): string {
  const map: Record<number, string> = { 1: '#22c55e', 2: '#84cc16', 3: '#f59e0b', 4: '#f97316', 5: '#ef4444' };
  return map[acuity] ?? '#888';
}

function statusChip(status: string): string {
  const map: Record<string, string> = {
    admitted: 'bg-blue-500/20 text-blue-300',
    discharging: 'bg-amber-500/20 text-amber-300',
    transferred: 'bg-purple-500/20 text-purple-300',
    pending_admission: 'bg-slate-500/20 text-slate-300',
    observation: 'bg-teal-500/20 text-teal-300',
  };
  return map[status] ?? 'bg-slate-500/20 text-slate-300';
}

function PatientRow({ patient, isExpanded, isSelected, onToggleExpand, onToggleSelect, onAckFlag, style }: PatientRowProps) {
  return (
    <div
      style={style}
      className={`absolute left-0 right-0 flex flex-col border-b border-white/5 transition-colors ${
        isSelected ? 'bg-blue-900/30' : 'bg-transparent hover:bg-white/5'
      }`}
    >
      {/* Collapsed row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(patient.id)}
          className="h-3.5 w-3.5 accent-blue-500"
          aria-label={`Select ${patient.first_name} ${patient.last_name}`}
        />
        <span className="w-20 shrink-0 text-xs text-slate-400">{patient.mrn}</span>
        <span className="flex-1 truncate text-sm font-medium text-white">
          {patient.first_name} {patient.last_name}
        </span>
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: acuityBg(patient.acuity) }}
          aria-label={`Acuity ${patient.acuity}`}
        >
          {patient.acuity}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusChip(patient.status)}`}>
          {patient.status.replace('_', ' ')}
        </span>
        <span className="w-14 shrink-0 text-right text-xs text-slate-400">{patient.los_hours}h</span>
        <span className={`w-14 shrink-0 text-right text-xs capitalize ${
          patient.fall_risk === 'high' ? 'text-red-400' : patient.fall_risk === 'moderate' ? 'text-amber-400' : 'text-slate-500'
        }`}>
          {patient.fall_risk}
        </span>
        <button
          onClick={() => onToggleExpand(patient.id)}
          className="ml-1 rounded p-1 text-slate-500 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          aria-expanded={isExpanded}
          aria-label="Toggle patient details"
        >
          <svg aria-hidden="true" className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 8L1 3h10z" />
          </svg>
        </button>
      </div>

      {/* Expanded section */}
      {isExpanded && (
        <div className="px-3 pb-2">
          {/* Last 3 vitals */}
          {patient.vitals.length > 0 && (
            <div className="mb-2 overflow-x-auto rounded border border-white/10">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-white/5">
                  {patient.vitals.slice(-3).reverse().map((v, i) => (
                    <tr key={i} className="text-slate-400">
                      <td className="px-2 py-1">{new Date(v.timestamp).toLocaleTimeString()}</td>
                      <td className="px-2 py-1">HR:{v.hr}</td>
                      <td className="px-2 py-1">BP:{v.bp_sys}/{v.bp_dia}</td>
                      <td className="px-2 py-1">SpO₂:{v.spo2}%</td>
                      <td className="px-2 py-1">{v.temp_c.toFixed(1)}°C</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Flags */}
          <div className="flex flex-wrap gap-1">
            {patient.flags.map((flag, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className={`rounded px-2 py-0.5 text-xs ${flag.acknowledged ? 'bg-slate-700 text-slate-400 line-through' : 'bg-red-500/20 text-red-300'}`}>
                  {flag.label}
                </span>
                {!flag.acknowledged && (
                  <button
                    onClick={() => onAckFlag(patient.id, i)}
                    className="rounded px-1.5 py-0.5 text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                    aria-label={`Acknowledge flag: ${flag.label}`}
                  >
                    Ack Flag
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PatientLog ───────────────────────────────────────────────────────────────
export function PatientLog({ indices, patients, containerHeight, stats }: PatientLogProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [localPatients, setLocalPatients] = useState<Patient[]>(patients);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const [, startTransition] = useTransition();
  const setSort = useFilterStore((s) => s.setSort);
  const sort = useFilterStore((s) => s.sort);

  // Sync patients from prop
  React.useEffect(() => { setLocalPatients(patients); }, [patients]);

  const deferredIndices = useDeferredValue(indices);

  const getHeight = useCallback(
    (idx: number) => {
      const patient = localPatients[deferredIndices[idx]];
      return patient && expanded.has(patient.id) ? ROW_EXPANDED : ROW_COLLAPSED;
    },
    [localPatients, deferredIndices, expanded]
  );

  const vs = useVirtualScroll(
    { totalItems: deferredIndices.length, getItemHeight: getHeight, containerHeight },
    forceUpdate
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    forceUpdate();
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Ctrl+A / Cmd+A
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      const allIds = deferredIndices.map((i) => localPatients[i]?.id).filter(Boolean) as string[];
      setSelected(new Set(allIds));
    }
  }, [deferredIndices, localPatients]);

  // Sort header click
  function handleSortClick(key: SortKey, shiftKey: boolean) {
    startTransition(() => {
      const cols = sort.columns;
      const existing = cols.findIndex((c) => c.key === key);
      if (shiftKey) {
        if (existing !== -1) {
          const col = cols[existing];
          const updated = col.dir === 'asc'
            ? cols.map((c, i) => i === existing ? { ...c, dir: 'desc' as const } : c)
            : cols.filter((_, i) => i !== existing);
          setSort({ columns: updated.slice(0, 3) });
        } else {
          setSort({ columns: [...cols, { key, dir: 'asc' }].slice(0, 3) });
        }
      } else {
        if (existing !== -1 && cols.length === 1) {
          const col = cols[0];
          if (col.dir === 'asc') setSort({ columns: [{ key, dir: 'desc' }] });
          else setSort({ columns: [{ key, dir: 'asc' }] });
        } else {
          setSort({ columns: [{ key, dir: 'asc' }] });
        }
      }
    });
  }

  // Optimistic ack flag
  const handleAckFlag = useCallback((patientId: string, flagIdx: number) => {
    setLocalPatients((prev) =>
      prev.map((p) => {
        if (p.id !== patientId) return p;
        const flags = p.flags.map((f, i) => i === flagIdx ? { ...f, acknowledged: true } : f);
        return { ...p, flags };
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    (async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/v1/patients/${patientId}/flags/${flagIdx}/acknowledge`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('ack failed');
      } catch {
        // Rollback
        setLocalPatients((prev) =>
          prev.map((p) => {
            if (p.id !== patientId) return p;
            const flags = p.flags.map((f, i) => i === flagIdx ? { ...f, acknowledged: false } : f);
            return { ...p, flags };
          })
        );
      }
    })();
  }, []);

  function getSortIndicator(key: SortKey) {
    const col = sort.columns.find((c) => c.key === key);
    if (!col) return null;
    return col.dir === 'asc' ? ' ↑' : ' ↓';
  }

  const visibleRows: JSX.Element[] = [];
  let offset = vs.offsetY;
  for (let vIdx = vs.startIndex; vIdx <= vs.endIndex; vIdx++) {
    const pIdx = deferredIndices[vIdx];
    if (pIdx === undefined) continue;
    const patient = localPatients[pIdx];
    if (!patient) continue;
    const h = getHeight(vIdx);
    visibleRows.push(
      <PatientRow
        key={patient.id}
        patient={patient}
        isExpanded={expanded.has(patient.id)}
        isSelected={selected.has(patient.id)}
        onToggleExpand={toggleExpand}
        onToggleSelect={toggleSelect}
        onAckFlag={handleAckFlag}
        style={{ top: offset, height: h }}
      />
    );
    offset += h;
  }

  // Stats footer
  const avgAcuity = stats
    ? Object.entries(stats.by_acuity).reduce((sum, [k, v]) => sum + Number(k) * v, 0) /
      Math.max(1, deferredIndices.length)
    : 0;
  const longestLos = deferredIndices.length > 0
    ? Math.max(...deferredIndices.map((i) => localPatients[i]?.los_hours ?? 0))
    : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-slate-900/95 px-3 py-2 text-xs font-semibold text-slate-400 backdrop-blur">
        <div className="w-5 shrink-0" />
        <div className="w-20 shrink-0">MRN</div>
        <button className="flex-1 text-left hover:text-white" onClick={(e) => handleSortClick('name', e.shiftKey)}>
          Name{getSortIndicator('name')}
        </button>
        <button className="w-10 text-center hover:text-white" onClick={(e) => handleSortClick('acuity', e.shiftKey)}>
          Acuity{getSortIndicator('acuity')}
        </button>
        <div className="w-20 text-center">Status</div>
        <button className="w-14 text-right hover:text-white" onClick={(e) => handleSortClick('los', e.shiftKey)}>
          LOS{getSortIndicator('los')}
        </button>
        <div className="w-14 text-right">Fall Rx</div>
        <div className="w-6" aria-hidden="true" />
      </div>

      {/* Scrollable virtual list */}
      <div
        className="relative flex-1 overflow-y-auto focus:outline-none"
        style={{ height: containerHeight }}
        onScroll={vs.onScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="list"
        aria-label="Patient list"
      >
        {/* Total height spacer */}
        <div style={{ height: vs.totalHeight, pointerEvents: 'none' }} aria-hidden="true" />
        {/* Rendered rows */}
        {visibleRows}
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-12 z-20 mx-4 flex items-center gap-2 rounded-xl bg-blue-900/90 px-4 py-2 shadow-lg ring-1 ring-white/10 backdrop-blur">
          <span className="text-sm text-white">{selected.size} selected</span>
          <button className="ml-auto rounded px-3 py-1 text-sm bg-white/10 text-white hover:bg-white/20">Assign Provider</button>
          <button className="rounded px-3 py-1 text-sm bg-white/10 text-white hover:bg-white/20">Flag for Review</button>
          <button onClick={() => setSelected(new Set())} className="rounded px-3 py-1 text-sm text-slate-400 hover:text-white">Clear</button>
        </div>
      )}

      {/* Sticky footer stats */}
      <div className="sticky bottom-0 border-t border-white/10 bg-slate-900/95 px-3 py-2 text-xs text-slate-400 backdrop-blur">
        {deferredIndices.length} patients &nbsp;|&nbsp;
        Avg acuity: {avgAcuity.toFixed(1)} &nbsp;|&nbsp;
        Longest LOS: {longestLos}h &nbsp;|&nbsp;
        Nurse ratio: {((deferredIndices.length) / Math.max(1, stats?.nurse_ratio_violations.length + 1 ?? 1)).toFixed(1)}
      </div>
    </div>
  );
}
