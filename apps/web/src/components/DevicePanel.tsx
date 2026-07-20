'use client';

import { ChevronRight, Loader2, Radio, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { StatusBadge } from './ui/misc';
import type { DeviceSummary } from '@/lib/types';
import { cn, deviceConnectivity, formatSpeed, isOnline, timeAgo } from '@/lib/utils';

interface Props {
  devices: DeviceSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}

export function DevicePanel({ devices, selectedId, loading, error, onSelect }: Props) {
  const [q, setQ] = useState('');
  const filtered = useMemo(
    () =>
      devices.filter(
        (d) =>
          d.name.toLowerCase().includes(q.toLowerCase()) ||
          d.imei.includes(q) ||
          (d.registrationNumber ?? '').toLowerCase().includes(q.toLowerCase()),
      ),
    [devices, q],
  );
  const activeCount = devices.filter((d) => isOnline(d.lastSeen)).length;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Fleet</h2>
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-success">{activeCount}</span> live · {devices.length} total
          </span>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, IMEI, plate…"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading devices…
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-danger">{error}</div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <Radio className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No devices yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Add a tracker to see it live on the map.</p>
            <Link href="/devices" className="mt-4 text-sm font-medium text-primary hover:underline">
              Add a device →
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No matches for “{q}”.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => onSelect(d.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent',
                    d.id === selectedId && 'bg-primary/10',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{d.name}</p>
                      <StatusBadge status={deviceConnectivity(d)} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{d.lastPosition ? formatSpeed(d.lastPosition.speedKph) : '—'}</span>
                      <span>·</span>
                      <span>{timeAgo(d.lastSeen)}</span>
                      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">
                        {d.protocol}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
