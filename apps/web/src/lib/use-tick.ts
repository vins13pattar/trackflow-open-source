'use client';

import { useEffect, useState } from 'react';

/** Re-renders the component every `ms` so time-derived values (e.g. online/offline) refresh. */
export function useTick(ms = 30_000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}
