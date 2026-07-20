'use client';

import { Check, Loader2, MapPin, Pencil, Pentagon, Plus, Power, Shapes, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GeofenceMap } from '@/components/GeofenceMap';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { GeofenceSummary } from '@/lib/types';

const CHANNELS = ['console', 'email', 'sms'];

interface EditState {
  name: string;
  onEntry: boolean;
  onExit: boolean;
  channels: string[];
  emails: string;
}

export default function GeofencesPage() {
  const [geofences, setGeofences] = useState<GeofenceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [drawMode, setDrawMode] = useState<'circle' | 'polygon'>('circle');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusM, setRadiusM] = useState(300);
  const [polygonPoints, setPolygonPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [name, setName] = useState('');
  const [onEntry, setOnEntry] = useState(true);
  const [onExit, setOnExit] = useState(true);
  const [channels, setChannels] = useState<string[]>(['console']);
  const [emails, setEmails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode
  const [editId, setEditId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = () =>
    api
      .listGeofences()
      .then((r) => setGeofences(r.geofences))
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
  }, []);

  function reset() {
    setCreating(false);
    setCenter(null);
    setName('');
    setEmails('');
    setChannels(['console']);
    setError(null);
    setDrawMode('circle');
    setPolygonPoints([]);
    setPolygonClosed(false);
  }

  function startEdit(g: GeofenceSummary) {
    setEditId(g.id);
    setEditState({
      name: g.name,
      onEntry: g.onEntry,
      onExit: g.onExit,
      channels: g.channels,
      emails: g.recipients?.emails?.join(', ') ?? '',
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditState(null);
    setEditError(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId || !editState) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await api.updateGeofence(editId, {
        name: editState.name,
        onEntry: editState.onEntry,
        onExit: editState.onExit,
        channels: editState.channels,
        recipients: editState.emails.trim() ? { emails: editState.emails.split(',').map((s) => s.trim()).filter(Boolean) } : undefined,
      });
      cancelEdit();
      await load();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditSubmitting(false);
    }
  }

  function setEdit<K extends keyof EditState>(k: K) {
    return (v: EditState[K]) => setEditState((s) => (s ? { ...s, [k]: v } : s));
  }

  function toggleEditChannel(ch: string) {
    setEditState((s) => {
      if (!s) return s;
      const next = s.channels.includes(ch) ? s.channels.filter((c) => c !== ch) : [...s.channels, ch];
      return { ...s, channels: next };
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (drawMode === 'circle') {
        if (!center) { setError('Click the map to place the zone center.'); setSubmitting(false); return; }
        await api.createGeofence({ name, type: 'circle', center, radiusM, onEntry, onExit, channels, recipients: emails.trim() ? { emails: emails.split(',').map((s) => s.trim()).filter(Boolean) } : undefined });
      } else {
        if (polygonPoints.length < 3) { setError('Add at least 3 vertices (double-click to close).'); setSubmitting(false); return; }
        await api.createGeofence({ name, type: 'polygon', points: polygonPoints, onEntry, onExit, channels, recipients: emails.trim() ? { emails: emails.split(',').map((s) => s.trim()).filter(Boolean) } : undefined });
      }
      reset();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const toggleChannel = (ch: string) =>
    setChannels((cur) => (cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch]));

  function handlePick(lat: number, lng: number) {
    if (drawMode === 'circle') {
      setCenter({ lat, lng });
    } else if (!polygonClosed) {
      setPolygonPoints((pts) => [...pts, { lat, lng }]);
    }
  }

  function handlePolygonClose() {
    if (polygonPoints.length >= 3) setPolygonClosed(true);
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="order-2 flex min-h-0 flex-1 flex-col border-t border-border lg:order-1 lg:w-96 lg:flex-none lg:border-r lg:border-t-0">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold">Geofences</h2>
          {!creating && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New zone
            </Button>
          )}
        </div>

        {creating ? (
          <form onSubmit={save} className="space-y-4 overflow-y-auto p-4">
            {/* Draw mode toggle */}
            <div className="flex gap-1 rounded-md border border-border p-1">
              <button
                type="button"
                onClick={() => { setDrawMode('circle'); setPolygonPoints([]); setPolygonClosed(false); }}
                className={'flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-colors ' + (drawMode === 'circle' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
              >
                <MapPin className="h-3.5 w-3.5" /> Circle
              </button>
              <button
                type="button"
                onClick={() => { setDrawMode('polygon'); setCenter(null); }}
                className={'flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-colors ' + (drawMode === 'polygon' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
              >
                <Pentagon className="h-3.5 w-3.5" /> Polygon
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
              {drawMode === 'circle' ? (
                <>
                  <MapPin className="h-4 w-4 shrink-0" />
                  {center ? `Center: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` : 'Click the map to place the center'}
                </>
              ) : (
                <>
                  <Pentagon className="h-4 w-4 shrink-0" />
                  {polygonClosed
                    ? `${polygonPoints.length} vertices — polygon closed`
                    : polygonPoints.length > 0
                      ? `${polygonPoints.length} vertices — double-click to close`
                      : 'Click the map to add vertices'}
                </>
              )}
            </div>

            <div>
              <Label htmlFor="g-name">Zone name</Label>
              <Input id="g-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="HQ / School / Depot" />
            </div>

            {drawMode === 'circle' && (
              <div>
                <Label htmlFor="g-radius">Radius: {radiusM} m</Label>
                <input id="g-radius" type="range" min={50} max={2000} step={50} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} className="w-full accent-primary" />
              </div>
            )}

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onEntry} onChange={(e) => setOnEntry(e.target.checked)} className="accent-primary" /> On entry
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onExit} onChange={(e) => setOnExit(e.target.checked)} className="accent-primary" /> On exit
              </label>
            </div>
            <div>
              <Label>Alert channels</Label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    type="button"
                    key={ch}
                    onClick={() => toggleChannel(ch)}
                    className={'rounded-full border px-3 py-1 text-xs font-medium ' + (channels.includes(ch) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="g-emails">Notify emails (optional, comma-separated)</Label>
              <Input id="g-emails" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@acme.in" />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Save zone
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : geofences.length === 0 ? (
              <div className="flex flex-col items-center p-8 text-center">
                <Shapes className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No geofences yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Create a zone to get entry/exit alerts.</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {geofences.map((g) => (
                  <li key={g.id}>
                    {editId === g.id && editState ? (
                      <form onSubmit={saveEdit} className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                        <div>
                          <Label htmlFor={`edit-name-${g.id}`}>Name</Label>
                          <Input id={`edit-name-${g.id}`} required value={editState.name} onChange={(e) => setEdit('name')(e.target.value)} />
                        </div>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" checked={editState.onEntry} onChange={(e) => setEdit('onEntry')(e.target.checked)} className="accent-primary" /> On entry
                          </label>
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" checked={editState.onExit} onChange={(e) => setEdit('onExit')(e.target.checked)} className="accent-primary" /> On exit
                          </label>
                        </div>
                        <div>
                          <Label>Channels</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {CHANNELS.map((ch) => (
                              <button
                                type="button"
                                key={ch}
                                onClick={() => toggleEditChannel(ch)}
                                className={'rounded-full border px-2.5 py-0.5 text-xs ' + (editState.channels.includes(ch) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}
                              >
                                {ch}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label htmlFor={`edit-emails-${g.id}`}>Notify emails</Label>
                          <Input id={`edit-emails-${g.id}`} value={editState.emails} onChange={(e) => setEdit('emails')(e.target.value)} placeholder="ops@acme.in" />
                        </div>
                        {editError && <p className="text-xs text-danger">{editError}</p>}
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={editSubmitting}>
                            {editSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                            <X className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className={'flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent' + (g.status === 'inactive' ? ' opacity-50' : '')}>
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: g.color }} />
                          <div>
                            <p className="text-sm font-medium">
                              {g.name}
                              {g.status === 'inactive' && <span className="ml-2 text-xs text-muted-foreground">(disabled)</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {g.radiusM ? `${g.radiusM} m` : g.type} · {g.channels.join(', ')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(g)}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            aria-label="Edit"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => api.updateGeofence(g.id, { status: g.status === 'inactive' ? 'active' : 'inactive' }).then(load)}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            aria-label={g.status === 'inactive' ? 'Enable' : 'Disable'}
                            title={g.status === 'inactive' ? 'Enable' : 'Disable'}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                          <button onClick={() => api.deleteGeofence(g.id).then(load)} className="rounded p-1 text-muted-foreground hover:text-danger" aria-label="Delete">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="order-1 h-[45vh] min-h-0 flex-1 lg:order-2 lg:h-auto">
        <GeofenceMap
          geofences={geofences}
          creating={creating}
          drawMode={drawMode}
          draftCenter={center}
          draftRadiusM={radiusM}
          draftPolygon={polygonPoints}
          onPick={handlePick}
          onPolygonClose={handlePolygonClose}
        />
      </div>
    </div>
  );
}
