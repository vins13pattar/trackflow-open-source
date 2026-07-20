'use client';

import { AlertTriangle, BellOff, Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { API_BASE, api, getToken } from '@/lib/api';
import type { AlertEventLive, AlertSummary } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

const severityStyle: Record<string, string> = {
  critical: 'border-danger/40 text-danger',
  high: 'border-danger/40 text-danger',
  medium: 'border-warning/40 text-warning',
  low: 'border-border text-muted-foreground',
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyUnack, setOnlyUnack] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .listAlerts(onlyUnack)
      .then((r) => setAlerts(r.alerts))
      .finally(() => setLoading(false));
  }, [onlyUnack]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${API_BASE}/realtime/positions?token=${encodeURIComponent(token)}`);
    es.addEventListener('alert', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as AlertEventLive;
      setAlerts((prev) => [
        { ...e, acknowledged: false, acknowledgedAt: null, notifications: [] },
        ...prev.filter((a) => a.id !== e.id),
      ]);
    });
    return () => es.close();
  }, []);

  async function ack(id: string) {
    const updated = await api.ackAlert(id);
    setAlerts((prev) =>
      onlyUnack ? prev.filter((a) => a.id !== id) : prev.map((a) => (a.id === id ? updated : a)),
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Alerts</h2>
          <p className="text-sm text-muted-foreground">Live geofence and device alerts.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyUnack} onChange={(e) => setOnlyUnack(e.target.checked)} className="accent-primary" />
          Unacknowledged only
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
          <BellOff className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No alerts</p>
          <p className="mt-1 text-sm text-muted-foreground">You’re all caught up.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors',
                a.acknowledged ? 'border-border opacity-60' : severityStyle[a.severity] ?? 'border-border',
              )}
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{a.title}</p>
                  <span className="rounded-full border px-2 py-0.5 text-xs capitalize">{a.severity}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{a.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
                {a.notifications.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.notifications.map((n) => `${n.channel}: ${n.status}`).join(' · ')}
                  </p>
                )}
              </div>
              {!a.acknowledged && (
                <Button size="sm" variant="outline" onClick={() => ack(a.id)}>
                  <Check className="h-4 w-4" /> Ack
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
