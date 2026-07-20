'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/observability';

/** Route-segment error boundary: reports to Sentry and offers a retry. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, { digest: error.digest, boundary: 'route' });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
        <AlertCircle className="h-6 w-6 text-danger" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          This part of the dashboard hit an unexpected error. You can try again — if it keeps happening, our team has
          been notified.
        </p>
      </div>
      <Button onClick={reset}>
        <RotateCw className="h-4 w-4" /> Try again
      </Button>
    </div>
  );
}
