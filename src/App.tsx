import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, useState, useCallback, useEffect, useReducer } from 'react';
import { queryClient } from './api/queryClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineBanner } from './components/OfflineBanner';
import { BedMap } from './components/BedMap';
import { PatientLog } from './components/PatientLog';
import { AlertPanel } from './components/AlertPanel';
import { useUnitStore } from './store/unitSlice';
import { useBedStore } from './store/bedSlice';
import { useAlertStore } from './store/alertSlice';
import { useLayoutStore } from './store/layoutSlice';
import { useFilterStore } from './store/filterSlice';
import { useUnits } from './api/useUnits';
import { usePatients } from './api/usePatients';
import { sseManager } from './services/sseManager';
import { useUnitViewState } from './hooks/useUnitViewState';
import type { CensusStats, AcuityLevel, PatientStatus } from './types';

// ─── Unit Command View ────────────────────────────────────────────────────────
function UnitCommandView() {
  const { units, selectedUnitId, setUnits, setSelectedUnitId } = useUnitStore();
  const { layout, setLayout } = useLayoutStore();
  const { beds, setBeds, updateBed } = useBedStore();
  const { setAlerts, addAlert, resolveAlert } = useAlertStore();
  const { filters, sort } = useFilterStore();
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // URL state sync
  useUnitViewState();

  // Fetch units
  const { data: unitsData } = useUnits();
  useEffect(() => {
    if (unitsData) {
      setUnits(unitsData);
      if (!selectedUnitId && unitsData.length > 0) setSelectedUnitId(unitsData[0].id);
    }
  }, [unitsData, setUnits, selectedUnitId, setSelectedUnitId]);

  // Fetch patients for this unit
  const { data: patientsData } = usePatients({ unitId: selectedUnitId, filters, sort });
  const patients = patientsData ?? [];

  // Derive indices (all)
  const indices = patients.map((_, i) => i);

  // Derive beds from patients
  useEffect(() => {
    if (patientsData) {
      const newBeds = patientsData
        .filter((p) => p.bed_id)
        .map((p) => ({
          id: p.bed_id!,
          unit_id: p.unit_id,
          room: p.bed_id!.split('-')[0],
          label: p.bed_id!.split('-')[1] ?? 'A',
          status: 'occupied' as const,
          patient_id: p.id,
          isolation_type: p.isolation_type,
          telemetry_equipped: false,
          updated_at: p.updated_at,
        }));
      setBeds(newBeds);
    }
  }, [patientsData, setBeds]);

  // Fetch alerts
  useEffect(() => {
    if (!selectedUnitId) return;
    fetch(`http://localhost:3001/api/v1/alerts?unit_id=${selectedUnitId}`)
      .then((r) => r.json())
      .then((data) => setAlerts(data))
      .catch(console.error);
  }, [selectedUnitId, setAlerts]);

  // SSE connection
  useEffect(() => {
    if (!selectedUnitId) return;
    sseManager.connect(selectedUnitId);

    const unsubBed = sseManager.subscribe('BED_STATUS_CHANGED', ({ bed_id, new_status, patient_id }) => {
      const existing = useBedStore.getState().beds.find((b) => b.id === bed_id);
      if (existing) updateBed({ ...existing, status: new_status, patient_id: patient_id ?? null });
      forceUpdate();
    });

    const unsubAlert = sseManager.subscribe('ALERT_FIRED', (alert) => {
      addAlert(alert);
    });

    const unsubResolve = sseManager.subscribe('ALERT_RESOLVED', ({ alert_id, resolved_at }) => {
      resolveAlert(alert_id, resolved_at);
    });

    return () => {
      unsubBed(); unsubAlert(); unsubResolve();
      sseManager.disconnect();
    };
  }, [selectedUnitId, updateBed, addAlert, resolveAlert]);

  // Compute stats from patients
  const stats: CensusStats = {
    by_acuity: patients.reduce((acc, p) => { acc[p.acuity] = (acc[p.acuity] ?? 0) + 1; return acc; }, {} as Record<AcuityLevel, number>),
    by_status: patients.reduce((acc, p) => { acc[p.status] = (acc[p.status] ?? 0) + 1; return acc; }, {} as Record<PatientStatus, number>),
    avg_los: patients.length > 0 ? patients.reduce((s, p) => s + p.los_hours, 0) / patients.length : 0,
    patients_over_target_los: patients.filter((p) => p.los_hours > 72).length,
    beds_available: patients.filter((p) => !p.bed_id).length,
    nurse_ratio_violations: [],
  };

  const containerH = Math.max(400, window.innerHeight - 180);

  const handleUnitChange = useCallback((id: string) => {
    setSelectedUnitId(id);
  }, [setSelectedUnitId]);

  return (
    <div className="flex h-screen flex-col bg-slate-950">
      {/* ── Top Nav ── */}
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-slate-900/80 px-6 py-3 backdrop-blur">
        {/* Logo / brand */}
        <div className="flex items-center gap-2">
          <svg aria-hidden="true" className="h-7 w-7 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-base font-bold tracking-tight text-white">PulseOps</span>
          <span className="text-xs text-slate-500">Unit Command View</span>
        </div>

        {/* Unit selector */}
        <nav role="navigation" aria-label="Unit selector" className="flex items-center gap-1 overflow-x-auto">
          {units.map((u) => (
            <button
              key={u.id}
              onClick={() => handleUnitChange(u.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                selectedUnitId === u.id
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
              aria-current={selectedUnitId === u.id ? 'page' : undefined}
            >
              {u.name}
            </button>
          ))}
        </nav>

        {/* Layout toggles */}
        <div className="ml-auto flex items-center gap-2">
          {/* Heatmap toggle */}
          <button
            onClick={() => setHeatmapMode((m) => !m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${heatmapMode ? 'bg-purple-600 text-white' : 'text-slate-400 bg-white/10 hover:text-white'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
            aria-pressed={heatmapMode}
          >
            Heatmap
          </button>
          {(['split', 'map', 'log'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLayout(l)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${layout === l ? 'bg-blue-600 text-white' : 'text-slate-400 bg-white/10 hover:text-white'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
              aria-pressed={layout === l}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      {/* ── 3-Panel Body ── */}
      <main className="flex flex-1 overflow-hidden">
        {/* BedMap panel */}
        {(layout === 'split' || layout === 'map') && (
          <section
            aria-label="Bed Map"
            className={`flex flex-col border-r border-white/10 ${layout === 'split' ? 'w-1/2' : 'flex-1'} overflow-hidden`}
          >
            <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/60 px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bed Map</h2>
              <span className="text-xs text-slate-500">{beds.length} beds</span>
            </div>
            <ErrorBoundary fallbackTitle="Bed map failed to load.">
              <BedMap
                beds={beds}
                patients={patients}
                unitId={selectedUnitId ?? ''}
                heatmapMode={heatmapMode}
              />
            </ErrorBoundary>
          </section>
        )}

        {/* Right column: PatientLog + AlertPanel */}
        {(layout === 'split' || layout === 'log') && (
          <div className={`flex flex-col ${layout === 'split' ? 'w-1/2' : 'flex-1'} overflow-hidden`}>
            {/* PatientLog */}
            <section
              aria-label="Patient Log"
              className="flex flex-col border-b border-white/10"
              style={{ height: `${Math.round(containerH * 0.6)}px` }}
            >
              <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/60 px-4 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Patient Log</h2>
                <span className="text-xs text-slate-500">{patients.length} patients</span>
              </div>
              <ErrorBoundary fallbackTitle="Patient log failed to load.">
                <PatientLog
                  indices={indices}
                  patients={patients}
                  containerHeight={Math.round(containerH * 0.6) - 36}
                  stats={stats}
                />
              </ErrorBoundary>
            </section>

            {/* AlertPanel */}
            <section
              aria-label="Alert Panel"
              className="flex flex-col overflow-hidden"
              style={{ height: `${Math.round(containerH * 0.4)}px` }}
            >
              <ErrorBoundary fallbackTitle="Alert panel failed to load.">
                {selectedUnitId && <AlertPanel unitId={selectedUnitId} />}
              </ErrorBoundary>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OfflineBanner />
        <Routes>
          <Route
            path="/"
            element={
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="flex h-screen items-center justify-center text-slate-400">
                    <svg aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Loading PulseOps…
                  </div>
                }>
                  <UnitCommandView />
                </Suspense>
              </ErrorBoundary>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}