# PulseOps — Unit Command View

A real-time hospital unit command center built with React 18, Vite, TypeScript (strict), Tailwind CSS v4, Zustand, TanStack Query, and Module Federation.

---

## Getting Started

### Prerequisites
- Node.js ≥ 18
- Run these commands from the project root

### 1. Generate Mock Data
```bash
cd mock-server
npm install
npm run seed
```
Creates `mock-server/data/hospital.json` with 450 patients, 8 units, 200+ beds, 80 staff, 40 alerts.

### 2. Start Mock Server (port 3001)
```bash
cd mock-server
npm start
```

### 3. Start Vite Dev Server (port 5173)
```bash
# In project root
npm run dev
```
Open `http://localhost:5173`

### 4. Run Tests
```bash
npm run test
```

### 5. Coverage Report
```bash
npm run coverage
```

---

## Architecture Decisions

### SSE over WebSocket
Server-Sent Events were chosen over WebSockets because:
- **Unidirectional** — only the server pushes; the client never sends data over the event stream
- **Firewall-friendly** — SSE works over HTTP/1.1 and is easier to proxy through hospital network appliances
- **Auto-reconnection** — browsers implement reconnect natively; our `SSEManager` adds exponential backoff with jitter on top
- **Sufficient** — the use case is server-push only; WebSocket bidirectionality adds unnecessary complexity

### Worker Message Protocol (index-based)
The `patientWorker` stores `Patient[]` in worker memory. On every filter/sort operation, it posts back only an `indices: number[]` array — not the full patient objects. This avoids:
- Redundant serialisation of ~400 patient records per keypress
- GC pressure from creating new arrays
- Race conditions where stale data crosses thread boundaries

### Bed Map Layout Algorithm
`computeBedLayout()` derives all SVG coordinates from a `LayoutConfig` object — no hardcoded pixel positions. Unit configuration drives layout automatically:
- Rooms are sorted alphanumerically and placed in a grid (`roomsPerRow` wide)
- Beds within a room are arranged in sub-columns (`bedsPerRow` wide)
- All positions derived from `(roomCol, roomRow, bedSubCol)` using config dimensions + gaps
- Changing any config value reflows the entire map

### ETag Conflict Resolution
The admit mutation implements optimistic locking:
1. Client reads `patient.etag` from query cache
2. Sends `If-Match: {etag}` with the POST request
3. Server returns **409 Conflict** with `current_state` diff if another writer changed the patient
4. Client surfaces a conflict dialog offering **"Use Latest"** (re-fetch and retry) or **"Cancel"**
5. Server is source of truth — silent overwrites are never allowed

---

## Performance Benchmarks

| Metric | Target | Implementation |
|---|---|---|
| Filter/sort latency | < 16ms | Web Worker with 100ms debounce |
| Rendered rows (400 patients) | ≤ visible + 16 overscan | `useVirtualScroll` RAF-batched |
| SSE reconnect (watchdog) | 15s no heartbeat → reconnect | `SSEManager` with backoff |
| URL state sync | 300ms debounce | `history.replaceState` (no push) |
| BedCell re-renders | 0 on unrelated prop changes | `React.memo` + `areEqual` |
| Filter → UI update | Deferred | `useTransition` + `useDeferredValue` |

---

## Accessibility

### ARIA Landmark Map
| Region | Element | ARIA |
|---|---|---|
| Unit nav | `<nav>` | `aria-label="Unit selector"` |
| Bed map | `<section>` | `aria-label="Bed Map"` |
| Patient log | `<section>` | `aria-label="Patient Log"` |
| Alert panel | `<section>` | `role="region" aria-label="Alert Panel"` |
| Slide-over | `<div>` | `role="dialog" aria-modal="true" aria-labelledby` |
| Offline banner | `<div>` | `role="alert" aria-live="assertive"` |

### Keyboard Navigation
| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move focus between elements |
| `Enter` / `Space` | Activate bed cell or button |
| `Arrow keys` | Pan bed map |
| `+` / `-` | Zoom bed map in / out |
| `Ctrl+A` / `Cmd+A` (Patient Log) | Select all patients |
| `Escape` | Close slide-over / modal |

### Screen Reader Notes
- BedCell `<g>` elements have `aria-label` with full context (room, bed, patient, acuity, isolation)
- Color is never the sole differentiator: acuity badges show numeric level, status chips show text
- All SVG icons are `aria-hidden="true"` with adjacent visible or `.sr-only` labels
- Critical alerts use `role="alert" aria-live="assertive"`; high/medium use `role="status" aria-live="polite"`

---

## Module Federation

The app exposes itself as a remote for micro-frontend shells:

```js
// In shell's vite.config.ts
federation({
  remotes: {
    unitCommandView: 'http://localhost:5173/assets/remoteEntry.js',
  },
  shared: ['react', 'react-dom', 'zustand', '@tanstack/react-query'],
})
```

```tsx
// In shell
const UnitCommandView = React.lazy(() => import('unitCommandView/UnitCommandView'));
```

---

## Known Limitations

1. **Transfer action** requires a destination selection UI — currently passes empty strings as placeholders
2. **Pinch-to-zoom** is implemented via touch event tracking but not fully tested on mobile browsers
3. **Saved views (IndexedDB)** are not synced across browser tabs
4. **Nurse ratio** calculation is a placeholder — real ratio requires richer staff-to-patient assignment  
5. **Mock server** restarts lose any in-memory mutations (admit/discharge/transfer) — run `npm run seed` again to reset
6. **Web Audio API chime** requires a prior user gesture (click) to initialise the `AudioContext` per browser policy

---

## Project Structure

```
PulseOps/
├── mock-server/          # Standalone Express SSE + REST server
│   ├── seed.ts           # Faker data generator
│   ├── server.ts         # Express app on :3001
│   └── data/             # hospital.json (gitignored)
├── src/
│   ├── api/              # TanStack Query hooks + mutation handlers
│   ├── components/
│   │   ├── AlertPanel/   # SSE-driven alert list + audio chimes
│   │   ├── BedMap/       # SVG zoom/pan bed grid + slide-over
│   │   ├── ErrorBoundary/
│   │   ├── OfflineBanner/
│   │   ├── PatientLog/   # Virtualised patient list + bulk select
│   │   └── SlideOver/    # Focus-trapped panel
│   ├── hooks/
│   │   └── useUnitViewState.ts   # URL ↔ Zustand + IndexedDB saved views
│   ├── services/
│   │   └── sseManager.ts         # EventSource + watchdog + dedup queue
│   ├── store/            # Zustand slices
│   ├── types/            # All TypeScript interfaces
│   └── workers/
│       └── patientWorker.ts      # Off-main-thread filter/sort/aggregate
├── vitest.config.ts
└── vite.config.ts        # Module Federation configured
```
