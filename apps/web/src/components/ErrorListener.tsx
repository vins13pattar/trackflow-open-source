'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/observability';

/** Reports errors that escape React's render path — unhandled promise
 *  rejections and uncaught window errors (e.g. async handlers, event callbacks).
 *  Renders nothing. No-op without NEXT_PUBLIC_SENTRY_DSN. */
export function ErrorListener() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportError(e.error instanceof Error ? e.error : new Error(e.message), { kind: 'window.onerror' });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      reportError(reason instanceof Error ? reason : new Error(String(reason)), { kind: 'unhandledrejection' });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
