'use client';

import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';

/** One-time reveal banner for a secret (API key / temp password). */
export function SecretReveal({
  label,
  value,
  onDismiss,
}: {
  label: string;
  value: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="animate-fade-in rounded-lg border border-success/40 bg-success/10 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-success">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Copy it now — it won’t be shown again.
          </p>
          <code className="mt-2 block overflow-x-auto rounded bg-background px-3 py-2 font-mono text-sm">
            {value}
          </code>
        </div>
        <button onClick={onDismiss} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
      <button
        onClick={copy}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-success hover:underline"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
