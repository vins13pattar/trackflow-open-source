'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/observability';

/** Root error boundary (catches failures in the root layout itself). Must render
 *  its own <html>/<body> because it replaces the whole tree. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, { digest: error.digest, boundary: 'global' });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '1rem',
          textAlign: 'center',
          padding: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Something went wrong</h2>
        <p style={{ color: '#6b7280', maxWidth: '24rem' }}>
          TrackFlow hit an unexpected error. Please try again — our team has been notified.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            background: '#4f46e5',
            color: 'white',
            border: 0,
            borderRadius: '0.5rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
