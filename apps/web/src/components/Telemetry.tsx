'use client';

import { Activity, Battery, Fuel, Gauge, type LucideIcon, Power, Signal, Thermometer, Zap } from 'lucide-react';
import type { Attributes } from '@/lib/types';

type V = number | boolean | string;

const KNOWN: { key: string; label: string; icon: LucideIcon; render: (v: V) => string; bool?: boolean }[] = [
  { key: 'ignition', label: 'Ignition', icon: Power, render: (v) => (v ? 'On' : 'Off'), bool: true },
  { key: 'motion', label: 'Motion', icon: Activity, render: (v) => (v ? 'Moving' : 'Stopped'), bool: true },
  { key: 'batteryPercent', label: 'Battery', icon: Battery, render: (v) => `${v}%` },
  { key: 'batteryVoltage', label: 'Batt. voltage', icon: Battery, render: (v) => `${v} V` },
  { key: 'externalVoltage', label: 'Power', icon: Zap, render: (v) => `${v} V` },
  { key: 'charging', label: 'Charging', icon: Zap, render: (v) => (v ? 'Yes' : 'No'), bool: true },
  { key: 'temperature', label: 'Temperature', icon: Thermometer, render: (v) => `${v} °C` },
  { key: 'fuelPercent', label: 'Fuel', icon: Fuel, render: (v) => `${v}%` },
  { key: 'gsmSignal', label: 'Signal', icon: Signal, render: (v) => `${v}/5` },
  { key: 'odometer', label: 'Odometer', icon: Gauge, render: (v) => `${v} km` },
  { key: 'rpm', label: 'RPM', icon: Gauge, render: (v) => `${v}` },
];

export function Telemetry({ attributes }: { attributes: Attributes | null | undefined }) {
  if (!attributes || Object.keys(attributes).length === 0) return null;
  const known = KNOWN.filter((k) => attributes[k.key] !== undefined);
  const rawKeys = Object.keys(attributes).filter((k) => !KNOWN.some((x) => x.key === k));

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Telemetry</p>
      <div className="grid grid-cols-2 gap-2">
        {known.map((k) => {
          const v = attributes[k.key]!;
          const Icon = k.icon;
          const tone = k.bool ? (v ? ' text-success' : ' text-muted-foreground') : '';
          return (
            <div key={k.key} className="rounded-md bg-muted/50 p-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon className="h-3 w-3" />
                {k.label}
              </div>
              <p className={`mt-0.5 text-sm font-medium${tone}`}>{k.render(v)}</p>
            </div>
          );
        })}
      </div>
      {rawKeys.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Other sensors ({rawKeys.length})</summary>
          <div className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
            {rawKeys.map((k) => (
              <div key={k}>
                {k}: {String(attributes[k])}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
