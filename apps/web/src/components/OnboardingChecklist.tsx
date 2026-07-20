'use client';

import { Check, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const KEY = 'trackflow.onboardingDismissed';

export function OnboardingChecklist({ hasDevices }: { hasDevices: boolean }) {
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage (avoids flash/mismatch)

  useEffect(() => {
    setDismissed(localStorage.getItem(KEY) === '1');
  }, []);

  if (dismissed) return null;

  const steps = [
    { label: 'Add a device', href: '/devices', done: hasDevices },
    { label: 'Connect it (or run a simulator)', href: '/help#connect', done: false },
    { label: 'Create a geofence', href: '/geofences', done: false },
    { label: 'Invite your team', href: '/settings', done: false },
  ];

  return (
    <div className="absolute right-4 top-4 z-10 w-72 animate-fade-in rounded-lg border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">Get started</p>
          <p className="text-xs text-muted-foreground">A few steps to go live.</p>
        </div>
        <button
          onClick={() => {
            localStorage.setItem(KEY, '1');
            setDismissed(true);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="flex items-center gap-2 text-sm hover:underline">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${s.done ? 'border-success bg-success text-white' : 'border-border'}`}
              >
                {s.done && <Check className="h-3 w-3" />}
              </span>
              <span className={s.done ? 'text-muted-foreground line-through' : ''}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/help" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
        Open the full guide →
      </Link>
    </div>
  );
}
