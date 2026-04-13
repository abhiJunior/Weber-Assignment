import React from 'react';
import type { Bed, Patient } from '../../types';
import type { BedLayout } from './layout';

// Status colour mapping via CSS custom properties
const STATUS_COLORS: Record<Bed['status'], string> = {
  available: 'var(--color-status-available)',
  occupied: 'var(--color-status-occupied)',
  cleaning: 'var(--color-status-cleaning)',
  maintenance: 'var(--color-status-maintenance)',
  blocked: 'var(--color-status-blocked)',
};

const ACUITY_COLORS: Record<number, string> = {
  1: 'var(--color-acuity-1)',
  2: 'var(--color-acuity-2)',
  3: 'var(--color-acuity-3)',
  4: 'var(--color-acuity-4)',
  5: 'var(--color-acuity-5)',
};

const HEATMAP_COLORS: Record<number, string> = {
  1: 'rgba(34,197,94,0.6)',
  2: 'rgba(132,204,22,0.65)',
  3: 'rgba(245,158,11,0.7)',
  4: 'rgba(249,115,22,0.8)',
  5: 'rgba(239,68,68,0.9)',
};

export interface BedCellProps {
  layout: BedLayout;
  bed: Bed;
  patient: Patient | null;
  isSelected: boolean;
  onSelect: (bedId: string) => void;
  heatmapMode?: boolean;
}

function BedCellInner({
  layout,
  bed,
  patient,
  isSelected,
  onSelect,
  heatmapMode = false,
}: BedCellProps) {
  const { x, y, width, height, bedLabel, roomLabel } = layout;
  const acuity = patient?.acuity ?? 0;

  const fillColor = heatmapMode
    ? acuity > 0
      ? HEATMAP_COLORS[acuity]
      : 'rgba(100,100,100,0.3)'
    : STATUS_COLORS[bed.status];

  const ariaLabel = [
    `Room ${roomLabel}, Bed ${bedLabel}`,
    `Status: ${bed.status}`,
    patient ? `Patient: ${patient.first_name} ${patient.last_name}, Acuity ${patient.acuity}` : 'No patient',
    bed.isolation_type ? `Isolation: ${bed.isolation_type}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(bed.id);
    }
  }

  return (
    <g
      transform={`translate(${x},${y})`}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      onClick={() => onSelect(bed.id)}
      onKeyDown={handleKey}
      style={{ cursor: 'pointer', outline: 'none' }}
    >
      {/* Main rect */}
      <rect
        width={width}
        height={height}
        rx={6}
        ry={6}
        fill={fillColor}
        stroke={isSelected ? '#60a5fa' : 'rgba(255,255,255,0.15)'}
        strokeWidth={isSelected ? 2.5 : 1}
        opacity={0.92}
      />

      {/* Bed label */}
      <text
        x={width / 2}
        y={height / 2 + 4}
        textAnchor="middle"
        fontSize={11}
        fontWeight="600"
        fill="rgba(255,255,255,0.9)"
        aria-hidden="true"
      >
        {bedLabel}
      </text>

      {/* Status short label */}
      <text
        x={width / 2}
        y={height / 2 + 16}
        textAnchor="middle"
        fontSize={9}
        fill="rgba(255,255,255,0.65)"
        aria-hidden="true"
      >
        {bed.status.toUpperCase()}
      </text>

      {/* Acuity badge (top-right) */}
      {patient && (
        <g aria-hidden="true">
          <circle cx={width - 10} cy={10} r={9} fill={ACUITY_COLORS[patient.acuity] ?? '#888'} />
          <text x={width - 10} y={14} textAnchor="middle" fontSize={9} fontWeight="700" fill="#fff">
            {patient.acuity}
          </text>
        </g>
      )}

      {/* Telemetry icon (top-left) */}
      {bed.telemetry_equipped && (
        <text x={4} y={13} fontSize={10} fill="rgba(255,255,255,0.8)" aria-hidden="true">
          ♥
        </text>
      )}

      {/* Isolation icon (bottom-left) */}
      {bed.isolation_type && (
        <text x={4} y={height - 5} fontSize={10} fill="#fef08a" aria-hidden="true">
          ⚠
        </text>
      )}

      {/* Fall risk icon (bottom-right) */}
      {(patient?.fall_risk === 'high' || patient?.fall_risk === 'moderate') && (
        <text x={width - 14} y={height - 5} fontSize={10} fill="#fca5a5" aria-hidden="true">
          △
        </text>
      )}
    </g>
  );
}

function areEqual(prev: BedCellProps, next: BedCellProps): boolean {
  return (
    prev.bed.status === next.bed.status &&
    prev.bed.patient_id === next.bed.patient_id &&
    prev.bed.isolation_type === next.bed.isolation_type &&
    prev.bed.telemetry_equipped === next.bed.telemetry_equipped &&
    prev.patient?.acuity === next.patient?.acuity &&
    prev.patient?.fall_risk === next.patient?.fall_risk &&
    prev.isSelected === next.isSelected &&
    prev.heatmapMode === next.heatmapMode
  );
}

export const BedCell = React.memo(BedCellInner, areEqual);
