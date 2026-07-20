'use client';

import { Cable, Loader2, Plus, Power, Radio, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConnectionGuide } from '@/components/ConnectionGuide';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, StatusBadge } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { DeviceSummary } from '@/lib/types';
import { useTick } from '@/lib/use-tick';
import { deviceConnectivity, timeAgo } from '@/lib/utils';

const empty = { name: '', imei: '', type: 'vehicle', protocol: 'gt06', registrationNumber: '', status: 'active' };

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connect, setConnect] = useState<DeviceSummary | null>(null);
  useTick();

  const load = () =>
    api
      .listDevices()
      .then((r) => setDevices(r.devices))
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createDevice({ ...form, registrationNumber: form.registrationNumber || undefined });
      setForm(empty);
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(d: DeviceSummary) {
    setBusy(d.id);
    try {
      await api.updateDevice(d.id, { status: d.status === 'inactive' ? 'active' : 'inactive' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: DeviceSummary) {
    if (!window.confirm(`Delete "${d.name}"? This also removes its history.`)) return;
    setBusy(d.id);
    try {
      await api.deleteDevice(d.id);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Devices</h2>
          <p className="text-sm text-muted-foreground">Register and manage your GPS trackers.</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          <Plus className="h-4 w-4" /> Add device
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6 animate-fade-in p-5">
          <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={form.name} onChange={set('name')} placeholder="KA-01-AB-1234" />
            </div>
            <div>
              <Label htmlFor="imei">IMEI (15 digits)</Label>
              <Input id="imei" required pattern="\d{15}" value={form.imei} onChange={set('imei')} placeholder="865432019876543" />
            </div>
            <div>
              <Label htmlFor="type">Type</Label>
              <select id="type" value={form.type} onChange={set('type')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {['vehicle', 'personal', 'asset', 'container'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="protocol">Protocol</Label>
              <select id="protocol" value={form.protocol} onChange={set('protocol')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {['gt06', 'h02', 'teltonika', 'nmea', 'queclink', 'meitrack'].map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="reg">Registration number (optional)</Label>
              <Input id="reg" value={form.registrationNumber} onChange={set('registrationNumber')} placeholder="KA01AB1234" />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <select id="status" value={form.status} onChange={set('status')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {['active', 'inactive', 'maintenance'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Create device
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center p-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <Radio className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">No devices yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add your first tracker to start receiving live positions.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="grid grid-cols-12 gap-2 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div className="col-span-5">Device</div>
              <div className="col-span-3">IMEI</div>
              <div className="col-span-2">Protocol</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            {devices.map((d) => (
              <div key={d.id} className="grid grid-cols-12 items-center gap-2 px-5 py-3 text-sm">
                <div className="col-span-5">
                  <p className="font-medium">{d.name}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <StatusBadge status={deviceConnectivity(d)} />
                    <span className="text-xs text-muted-foreground">· {timeAgo(d.lastSeen)}</span>
                  </div>
                </div>
                <div className="col-span-3 font-mono text-xs text-muted-foreground">{d.imei}</div>
                <div className="col-span-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">{d.protocol}</span>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => setConnect(d)}>
                    <Cable className="h-3.5 w-3.5" /> Connect
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy === d.id}
                    onClick={() => toggleStatus(d)}
                    title={d.status === 'inactive' ? 'Activate' : 'Deactivate'}
                    aria-label={d.status === 'inactive' ? 'Activate' : 'Deactivate'}
                  >
                    <Power className={`h-4 w-4 ${d.status === 'inactive' ? 'text-muted-foreground' : 'text-success'}`} />
                  </Button>
                  <Button size="icon" variant="ghost" disabled={busy === d.id} onClick={() => remove(d)} aria-label="Delete">
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {connect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConnect(null)}>
          <Card className="w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="font-semibold">Connect “{connect.name}”</h3>
                <p className="text-xs text-muted-foreground">{connect.protocol.toUpperCase()} device</p>
              </div>
              <button onClick={() => setConnect(null)} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ConnectionGuide imei={connect.imei} protocol={connect.protocol} />
          </Card>
        </div>
      )}
    </div>
  );
}
