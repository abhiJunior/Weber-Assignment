import { useEffect, useState } from 'react';
import { useLayoutStore } from '../../store/layoutSlice';

function relativeTime(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function OfflineBanner() {
  const { isOffline, offlineSince } = useLayoutStore();
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (isOffline) {
      setFadeOut(false);
      setVisible(true);
    } else if (visible) {
      setFadeOut(true);
      const t = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isOffline, visible]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-opacity duration-700 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      {isOffline ? (
        <span>
          ⚠ Live updates paused · Last update:{' '}
          {offlineSince ? relativeTime(offlineSince) : 'unknown'}
        </span>
      ) : (
        <span>Connection restored</span>
      )}
    </div>
  );
}
