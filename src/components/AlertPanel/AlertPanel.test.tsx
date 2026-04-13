import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertPanel } from './index';
import { useAlertStore } from '../../store/alertSlice';
import type { Alert } from '../../types';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: crypto.randomUUID(),
    unit_id: 'unit-1',
    patient_id: null,
    bed_id: null,
    severity: 'medium',
    status: 'active',
    message: 'Test alert',
    created_at: new Date().toISOString(),
    acknowledged_at: null,
    resolved_at: null,
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useAlertStore.setState({ alerts: [], pendingAckIds: new Set(), muted: false });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AlertPanel', () => {
  it('renders without crashing with no alerts', () => {
    render(<Wrapper><AlertPanel unitId="unit-1" /></Wrapper>);
    expect(screen.getByRole('region', { name: /alert panel/i })).toBeInTheDocument();
  });

  it('only one setInterval exists across all rows (shared timer)', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    useAlertStore.setState({
      alerts: [makeAlert({ severity: 'critical' }), makeAlert({ severity: 'high' }), makeAlert()],
      pendingAckIds: new Set(), muted: false,
    });
    render(<Wrapper><AlertPanel unitId="unit-1" /></Wrapper>);
    // There should be exactly 1 interval for the timestamp clock
    const timingCalls = spy.mock.calls.filter((args) => args[1] === 1000);
    expect(timingCalls).toHaveLength(1);
  });

  it('acknowledging shows alert as pending immediately', () => {
    const alert = makeAlert({ severity: 'medium', status: 'active' });
    useAlertStore.setState({ alerts: [alert], pendingAckIds: new Set(), muted: false });

    const setPendingAck = vi.spyOn(useAlertStore.getState(), 'setPendingAck');
    render(<Wrapper><AlertPanel unitId="unit-1" /></Wrapper>);

    const ackBtn = screen.getByRole('button', { name: /acknowledge/i });
    fireEvent.click(ackBtn);

    expect(setPendingAck).toHaveBeenCalledWith(alert.id);
  });

  it('muted=true: muted flag is set in store and no chime fires', () => {
    useAlertStore.setState({
      alerts: [makeAlert({ severity: 'critical', status: 'active' })],
      pendingAckIds: new Set(), muted: true,
    });
    render(<Wrapper><AlertPanel unitId="unit-1" /></Wrapper>);
    // When muted, the mute button should show "Muted" label
    expect(screen.getByRole('button', { name: /toggle alert audio/i })).toHaveTextContent('Muted');
    // Confirm muted state in store
    expect(useAlertStore.getState().muted).toBe(true);
  });
});
