import React, { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import type { Bed, Patient } from '../../types';
import { computeBedLayout } from './layout';
import { BedCell } from './BedCell';
import { useBedStore } from '../../store/bedSlice';
import { SlideOver } from '../SlideOver';
import { useMutateAdmit, useMutateDischarge, useMutateTransfer } from '../../api/mutations';

interface BedMapProps {
  beds: Bed[];
  patients: Patient[];
  unitId: string;
  heatmapMode?: boolean;
}

function BedMapSkeleton() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <svg aria-hidden="true" className="h-8 w-8 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <span className="text-sm">Loading bed map…</span>
      </div>
    </div>
  );
}

function BedMapInner({ beds, patients, unitId, heatmapMode = false }: BedMapProps) {
  const [scale, setScale] = useState(1);
  const [originX, setOriginX] = useState(0);
  const [originY, setOriginY] = useState(0);
  const dragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const selectedBedId = useBedStore((s) => s.selectedBedId);
  const setSelectedBedId = useBedStore((s) => s.setSelectedBedId);

  const [slideOpen, setSlideOpen] = useState(false);

  const admitMutation = useMutateAdmit();
  const dischargeMutation = useMutateDischarge();
  const transferMutation = useMutateTransfer();

  // Reset transform on unit change
  useEffect(() => {
    setScale(1);
    setOriginX(0);
    setOriginY(0);
  }, [unitId]);

  const layouts = computeBedLayout(beds);
  const patientMap = new Map(patients.map((p) => [p.id, p]));

  // Compute viewBox
  const maxX = Math.max(...layouts.map((l) => l.x + l.width), 200) + 40;
  const maxY = Math.max(...layouts.map((l) => l.y + l.height), 200) + 40;

  // Zoom via wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => Math.max(0.3, Math.min(3.0, prev * (1 + e.deltaY * -0.001))));
  }, []);

  // Pan via mouse
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startPos.current = { x: e.clientX - originX, y: e.clientY - originY };
  }, [originX, originY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setOriginX(e.clientX - startPos.current.x);
    setOriginY(e.clientY - startPos.current.y);
  }, []);

  const stopDrag = useCallback(() => { dragging.current = false; }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 20;
    switch (e.key) {
      case 'ArrowUp': setOriginY((y) => y + step); break;
      case 'ArrowDown': setOriginY((y) => y - step); break;
      case 'ArrowLeft': setOriginX((x) => x + step); break;
      case 'ArrowRight': setOriginX((x) => x - step); break;
      case '+': case '=': setScale((s) => Math.min(3.0, s * 1.1)); break;
      case '-': setScale((s) => Math.max(0.3, s * 0.9)); break;
    }
  }, []);

  const handleBedSelect = useCallback((bedId: string) => {
    setSelectedBedId(bedId);
    setSlideOpen(true);
  }, [setSelectedBedId]);

  const selectedBed = beds.find((b) => b.id === selectedBedId) ?? null;
  const selectedPatient = selectedBed?.patient_id ? (patientMap.get(selectedBed.patient_id) ?? null) : null;

  return (
    <div className="relative flex h-full flex-col">
      {/* Controls */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        <button
          onClick={() => { setScale(1); setOriginX(0); setOriginY(0); }}
          className="rounded px-3 py-1 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          Reset View
        </button>
        <span className="text-xs text-slate-500">Zoom: {(scale * 100).toFixed(0)}%</span>
        <span className="ml-auto text-xs text-slate-500">{beds.length} beds</span>
      </div>

      {/* SVG Map */}
      <div
        className="flex-1 overflow-hidden focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Bed map — use arrow keys to pan, +/- to zoom"
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${maxX} ${maxY}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}
          aria-label="Hospital unit bed map"
          role="application"
        >
          <g transform={`scale(${scale}) translate(${originX / scale},${originY / scale})`}>
            {/* Room backgrounds */}
            {(() => {
              const rooms = new Map<string, { x: number; y: number; maxX: number; maxY: number }>();
              for (const l of layouts) {
                const r = rooms.get(l.roomLabel);
                if (!r) rooms.set(l.roomLabel, { x: l.x - 6, y: l.y - 22, maxX: l.x + l.width + 6, maxY: l.y + l.height + 6 });
                else {
                  rooms.set(l.roomLabel, {
                    x: Math.min(r.x, l.x - 6), y: Math.min(r.y, l.y - 22),
                    maxX: Math.max(r.maxX, l.x + l.width + 6), maxY: Math.max(r.maxY, l.y + l.height + 6),
                  });
                }
              }
              return [...rooms.entries()].map(([label, r]) => (
                <g key={label}>
                  <rect x={r.x} y={r.y} width={r.maxX - r.x} height={r.maxY - r.y}
                    rx={8} fill="rgba(30,41,59,0.8)" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
                  <text x={r.x + 8} y={r.y + 14} fontSize={9} fill="rgba(255,255,255,0.4)" fontWeight="600">
                    {label}
                  </text>
                </g>
              ));
            })()}

            {/* Bed cells */}
            {layouts.map((layout) => {
              const bed = beds.find((b) => b.id === layout.bed_id);
              if (!bed) return null;
              const patient = bed.patient_id ? (patientMap.get(bed.patient_id) ?? null) : null;
              return (
                <BedCell
                  key={layout.bed_id}
                  layout={layout}
                  bed={bed}
                  patient={patient}
                  isSelected={layout.bed_id === selectedBedId}
                  onSelect={handleBedSelect}
                  heatmapMode={heatmapMode}
                />
              );
            })}
          </g>
        </svg>
      </div>

      {/* SlideOver Patient Detail */}
      <SlideOver
        open={slideOpen}
        onClose={() => setSlideOpen(false)}
        title={selectedBed ? `Room ${selectedBed.room} — Bed ${selectedBed.label}` : 'Bed Detail'}
      >
        {selectedBed && (
          <div className="space-y-6">
            {/* Bed Status */}
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white`}
                style={{ background: `var(--color-status-${selectedBed.status})` }}>
                {selectedBed.status}
              </span>
              {selectedBed.isolation_type && (
                <span className="rounded-full bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-300">
                  Isolation: {selectedBed.isolation_type}
                </span>
              )}
            </div>

            {/* Patient Demographics */}
            {selectedPatient ? (
              <div className="space-y-4">
                <div className="rounded-xl bg-white/5 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {selectedPatient.first_name} {selectedPatient.last_name}
                      </h3>
                      <p className="text-sm text-slate-400">MRN: {selectedPatient.mrn}</p>
                      <p className="text-sm text-slate-400">DOB: {selectedPatient.dob}</p>
                    </div>
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ background: `var(--color-acuity-${selectedPatient.acuity})` }}
                    >
                      {selectedPatient.acuity}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-slate-500">Status:</span> <span className="text-slate-300">{selectedPatient.status}</span></div>
                    <div><span className="text-slate-500">LOS:</span> <span className="text-slate-300">{selectedPatient.los_hours}h</span></div>
                    <div><span className="text-slate-500">Fall Risk:</span> <span className="text-slate-300 capitalize">{selectedPatient.fall_risk}</span></div>
                    <div><span className="text-slate-500">Code:</span> <span className="text-slate-300 uppercase">{selectedPatient.code_status}</span></div>
                  </div>
                  <p className="mt-3 text-sm"><span className="text-slate-500">Complaint:</span> <span className="text-slate-300">{selectedPatient.chief_complaint}</span></p>
                  <p className="text-sm"><span className="text-slate-500">Dx:</span> <span className="text-slate-300">{selectedPatient.admitting_dx}</span></p>
                </div>

                {/* Care Team */}
                {selectedPatient.care_team.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Care Team</h4>
                    <ul className="space-y-1">
                      {selectedPatient.care_team.map((m, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">{m.role}</span>
                          <span className="text-slate-300">{m.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Last 3 Vitals */}
                {selectedPatient.vitals.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Vitals</h4>
                    <div className="overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full text-xs">
                        <thead className="bg-white/5">
                          <tr>
                            <th className="px-2 py-1.5 text-left text-slate-400">Time</th>
                            <th className="px-2 py-1.5 text-right text-slate-400">HR</th>
                            <th className="px-2 py-1.5 text-right text-slate-400">BP</th>
                            <th className="px-2 py-1.5 text-right text-slate-400">SpO₂</th>
                            <th className="px-2 py-1.5 text-right text-slate-400">Temp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {selectedPatient.vitals.slice(-3).reverse().map((v, i) => (
                            <tr key={i} className="hover:bg-white/5">
                              <td className="px-2 py-1.5 text-slate-400">{new Date(v.timestamp).toLocaleTimeString()}</td>
                              <td className="px-2 py-1.5 text-right text-slate-300">{v.hr}</td>
                              <td className="px-2 py-1.5 text-right text-slate-300">{v.bp_sys}/{v.bp_dia}</td>
                              <td className="px-2 py-1.5 text-right text-slate-300">{v.spo2}%</td>
                              <td className="px-2 py-1.5 text-right text-slate-300">{v.temp_c.toFixed(1)}°C</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      if (selectedBed && selectedPatient) {
                        admitMutation.mutate({
                          patientId: selectedPatient.id,
                          etag: selectedPatient.etag,
                          bedId: selectedBed.id,
                          unitId: selectedBed.unit_id,
                        });
                      }
                    }}
                    className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  >
                    Admit
                  </button>
                  <button
                    onClick={() => {
                      dischargeMutation.mutate({ patientId: selectedPatient.id });
                    }}
                    className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  >
                    Discharge
                  </button>
                  <button
                    onClick={() => {
                      // Transfer example — UI could prompt for destination
                      transferMutation.mutate({ patientId: selectedPatient.id, toBedId: '', toUnitId: '' });
                    }}
                    className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  >
                    Transfer
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No patient assigned to this bed.</p>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}

export function BedMap(props: BedMapProps) {
  return (
    <Suspense fallback={<BedMapSkeleton />}>
      <BedMapInner {...props} />
    </Suspense>
  );
}
