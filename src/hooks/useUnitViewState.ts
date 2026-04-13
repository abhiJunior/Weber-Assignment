import { useLayoutEffect, useEffect, useCallback } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import { useUnitStore } from '../store/unitSlice';
import { useFilterStore } from '../store/filterSlice';
import { useLayoutStore } from '../store/layoutSlice';
import { sseManager } from '../services/sseManager';
import type { FilterState, SortState, SavedView } from '../types';

// ─── base64url helpers ────────────────────────────────────────────────────────
function encodeB64url(v: unknown): string {
  return btoa(JSON.stringify(v))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function decodeB64url(s: string): unknown {
  return JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
}

// ─── IDB setup ────────────────────────────────────────────────────────────────
let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB('pulseops', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('saved_views')) {
          const store = db.createObjectStore('saved_views', { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useUnitViewState() {
  const selectedUnitId = useUnitStore((s) => s.selectedUnitId);
  const setSelectedUnitId = useUnitStore((s) => s.setSelectedUnitId);
  const { filters, sort, setFilters, setSort } = useFilterStore();
  const { layout, zoomLevel, expandedPanels, isOffline, offlineSince, setLayout, setZoom, setOffline } = useLayoutStore();

  // ─── Parse URL on mount (synchronous via useLayoutEffect) ──────────────────
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const unit = params.get('unit');
    if (unit) setSelectedUnitId(unit);

    const f = params.get('f');
    if (f) {
      try { setFilters(decodeB64url(f) as Partial<FilterState>); } catch { /* ignore */ }
    }

    const s = params.get('s');
    if (s) {
      try { setSort(decodeB64url(s) as SortState); } catch { /* ignore */ }
    }

    const lay = params.get('layout');
    if (lay === 'map' || lay === 'log' || lay === 'split') setLayout(lay);

    const zoom = params.get('zoom');
    if (zoom) setZoom(parseFloat(zoom));
  }, [setSelectedUnitId, setFilters, setSort, setLayout, setZoom]);

  // ─── Sync Zustand state → URL (debounced 300ms) ───────────────────────────
  useEffect(() => {
    const id = setTimeout(() => {
      const params = new URLSearchParams();
      if (selectedUnitId) params.set('unit', selectedUnitId);
      params.set('f', encodeB64url(filters));
      params.set('s', encodeB64url(sort));
      params.set('layout', layout);
      params.set('zoom', zoomLevel.toFixed(2));
      params.set('panels', expandedPanels.join(','));
      window.history.replaceState(null, '', `?${params.toString()}`);
    }, 300);
    return () => clearTimeout(id);
  }, [selectedUnitId, filters, sort, layout, zoomLevel, expandedPanels]);

  // ─── SSE offline detection ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = sseManager.onStateChange((state) => {
      if (state === 'offline') setOffline(true, new Date().toISOString());
      else if (state === 'connected') setOffline(false);
    });
    return unsub;
  }, [setOffline]);

  // ─── SavedView CRUD ───────────────────────────────────────────────────────
  const saveView = useCallback(async (name: string) => {
    const db = await getDB();
    const view: SavedView = {
      id: crypto.randomUUID(),
      name,
      unit_id: selectedUnitId ?? '',
      filters,
      sort,
      layout,
      created_at: new Date().toISOString(),
    };
    await db.put('saved_views', view);
    return view;
  }, [selectedUnitId, filters, sort, layout]);

  const loadView = useCallback(async (name: string) => {
    const db = await getDB();
    const views = await db.getAllFromIndex('saved_views', 'name', name);
    const view = views[0] as SavedView | undefined;
    if (!view) return null;
    if (view.unit_id) setSelectedUnitId(view.unit_id);
    setFilters(view.filters);
    setSort(view.sort);
    setLayout(view.layout);
    return view;
  }, [setSelectedUnitId, setFilters, setSort, setLayout]);

  const deleteView = useCallback(async (id: string) => {
    const db = await getDB();
    await db.delete('saved_views', id);
  }, []);

  const listViews = useCallback(async (): Promise<SavedView[]> => {
    const db = await getDB();
    return db.getAll('saved_views') as Promise<SavedView[]>;
  }, []);

  return {
    saveView,
    loadView,
    deleteView,
    listViews,
    isOffline,
    offlineSince,
    queuedEventCount: 0,
  };
}
