'use client';

import { Activity, Download, Gauge, Loader2, MapPin, Route, ShieldCheck, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { api, downloadTripsCsv } from '@/lib/api';
import type { AnalyticsSummary, DistanceByDay } from '@/lib/types';

function Stat({ icon: Icon, label, value }: { icon: typeof Route; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

export default function ReportsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [days, setDays] = useState<DistanceByDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.analyticsSummary(), api.distanceByDay()])
      .then(([s, d]) => {
        setSummary(s);
        setDays(d.days);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Reports & analytics</h2>
          <p className="text-sm text-muted-foreground">Fleet activity over the last 7 days.</p>
        </div>
        <Button variant="outline" onClick={() => void downloadTripsCsv()}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={Route} label="Distance" value={`${summary?.distanceKm ?? 0} km`} />
            <Stat icon={MapPin} label="Trips" value={String(summary?.trips ?? 0)} />
            <Stat icon={Activity} label="Active" value={String(summary?.activeDevices ?? 0)} />
            <Stat icon={Gauge} label="Avg speed" value={`${summary?.avgSpeedKph ?? 0}`} />
            <Stat icon={Timer} label="Hours" value={`${summary?.durationHours ?? 0}`} />
            <Stat icon={ShieldCheck} label="Driver score" value={String(summary?.driverScore ?? 0)} />
          </div>

          <Card className="p-5">
            <h3 className="mb-4 font-semibold">Distance by day (km)</h3>
            {days.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <Route className="mb-2 h-8 w-8" />
                No trips yet. Once devices report movement, the rollup builds trips and they appear here.
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--accent))' }}
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="distanceKm" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
