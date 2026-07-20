'use client';

import { Loader2, MapPin, Plus, Truck, Unlink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Telemetry } from '@/components/Telemetry';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, StatusBadge } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { DeviceSummary, VehicleSummary } from '@/lib/types';
import { deviceConnectivity, timeAgo } from '@/lib/utils';

const empty = { name: '', registration: '', make: '', model: '' };

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.listVehicles(), api.listDevices()])
      .then(([v, d]) => {
        setVehicles(v.vehicles);
        setDevices(d.devices);
      })
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  const unassigned = devices.filter((d) => !d.vehicleId);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createVehicle({
        name: form.name,
        registration: form.registration || undefined,
        make: form.make || undefined,
        model: form.model || undefined,
      });
      setForm(empty);
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const attach = (vehicleId: string, deviceId: string) => api.updateDevice(deviceId, { vehicleId }).then(load);
  const detach = (deviceId: string) => api.updateDevice(deviceId, { vehicleId: null }).then(load);
  const removeVehicle = (id: string) => {
    if (window.confirm('Delete this vehicle? Its devices will be unassigned (not deleted).')) {
      void api.deleteVehicle(id).then(load);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Vehicles</h2>
          <p className="text-sm text-muted-foreground">Group devices &amp; sensors into vehicles with combined telemetry.</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          <Plus className="h-4 w-4" /> Add vehicle
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6 animate-fade-in p-5">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="v-name">Name</Label>
              <Input id="v-name" required value={form.name} onChange={set('name')} placeholder="Reefer Truck 1" />
            </div>
            <div>
              <Label htmlFor="v-reg">Registration</Label>
              <Input id="v-reg" value={form.registration} onChange={set('registration')} placeholder="KA-01-AB-1234" />
            </div>
            <div>
              <Label htmlFor="v-make">Make</Label>
              <Input id="v-make" value={form.make} onChange={set('make')} placeholder="Tata" />
            </div>
            <div>
              <Label htmlFor="v-model">Model</Label>
              <Input id="v-model" value={form.model} onChange={set('model')} placeholder="LPT 1109" />
            </div>
            {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Create vehicle
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : vehicles.length === 0 ? (
        <Card className="flex flex-col items-center p-12 text-center">
          <Truck className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No vehicles yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a vehicle, then attach its tracker and any sensors.</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {vehicles.map((v) => (
            <Card key={v.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{v.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[v.registration, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Vehicle'}
                  </p>
                </div>
                <button onClick={() => removeVehicle(v.id)} className="rounded p-1 text-muted-foreground hover:text-danger" aria-label="Delete vehicle">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {v.lastPosition ? (
                <p className="mt-2 flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {v.lastPosition.latitude.toFixed(5)}, {v.lastPosition.longitude.toFixed(5)} · {timeAgo(v.lastSeen)}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No position yet</p>
              )}

              <Telemetry attributes={v.attributes} />

              <div className="mt-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Devices ({v.deviceCount})
                </p>
                <ul className="space-y-1">
                  {v.devices.map((d) => (
                    <li key={d.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{d.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{d.protocol}</span>
                        <StatusBadge status={deviceConnectivity(d)} />
                      </div>
                      <button onClick={() => detach(d.id)} className="rounded p-1 text-muted-foreground hover:text-danger" aria-label="Detach">
                        <Unlink className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {v.devices.length === 0 && <li className="text-xs text-muted-foreground">No devices attached.</li>}
                </ul>

                {unassigned.length > 0 && (
                  <select
                    className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value=""
                    onChange={(e) => e.target.value && attach(v.id, e.target.value)}
                  >
                    <option value="">+ Attach a device…</option>
                    {unassigned.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.protocol.toUpperCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
