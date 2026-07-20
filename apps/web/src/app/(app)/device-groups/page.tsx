'use client';
import { Layers, Pencil, Plus, Trash2, X, Check, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { DeviceGroupSummary, DeviceSummary } from '@/lib/types';

const PRESET_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'];

const emptyForm = { name: '', description: '', color: PRESET_COLORS[0] };

interface EditState {
  name: string;
  description: string;
  color: string;
}

export default function DeviceGroupsPage() {
  const [groups, setGroups] = useState<DeviceGroupSummary[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit inline
  const [editId, setEditId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Member panel
  const [memberGroupId, setMemberGroupId] = useState<string | null>(null);
  const [memberSelection, setMemberSelection] = useState<Set<string>>(new Set());
  const [memberSaving, setMemberSaving] = useState(false);

  // Delete busy
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.listDeviceGroups(), api.listDevices()])
      .then(([gr, dev]) => {
        setGroups(gr.groups);
        setDevices(dev.devices);
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
  }, []);

  // ---- Create ----
  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setCreateError(null);
    try {
      await api.createDeviceGroup({
        name: form.name,
        description: form.description || undefined,
        color: form.color,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Edit ----
  function startEdit(g: DeviceGroupSummary) {
    setEditId(g.id);
    setEditState({ name: g.name, description: g.description ?? '', color: g.color });
    setEditError(null);
    // close member panel if open for same group
    if (memberGroupId === g.id) setMemberGroupId(null);
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
      await api.updateDeviceGroup(editId, {
        name: editState.name,
        description: editState.description || undefined,
        color: editState.color,
      });
      cancelEdit();
      await load();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditSubmitting(false);
    }
  }

  // ---- Delete ----
  async function remove(g: DeviceGroupSummary) {
    if (!window.confirm(`Delete group "${g.name}"?`)) return;
    setBusy(g.id);
    try {
      await api.deleteDeviceGroup(g.id);
      await load();
    } finally {
      setBusy(null);
    }
  }

  // ---- Member panel ----
  function openMembers(g: DeviceGroupSummary) {
    if (memberGroupId === g.id) {
      setMemberGroupId(null);
      return;
    }
    setMemberGroupId(g.id);
    setMemberSelection(new Set(g.deviceIds));
    // close edit if open for same group
    if (editId === g.id) cancelEdit();
  }

  function toggleMember(deviceId: string) {
    setMemberSelection((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  async function saveMembers() {
    if (!memberGroupId) return;
    setMemberSaving(true);
    try {
      const updated = await api.setGroupMembers(memberGroupId, Array.from(memberSelection));
      setGroups((gs) => gs.map((g) => (g.id === updated.id ? updated : g)));
      setMemberGroupId(null);
    } catch {
      // silently ignore; user can retry
    } finally {
      setMemberSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Device Groups</h2>
          <p className="text-sm text-muted-foreground">Organise devices into named groups for easier management.</p>
        </div>
        <Button onClick={() => { setShowForm((s) => !s); setCreateError(null); }}>
          <Plus className="h-4 w-4" /> New Group
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="mb-6 p-5">
          <form onSubmit={onCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="cg-name">Name</Label>
                <Input
                  id="cg-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Fleet A, Night shift…"
                />
              </div>
              <div>
                <Label htmlFor="cg-desc">Description (optional)</Label>
                <Input
                  id="cg-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short description"
                />
              </div>
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className={`w-4 h-4 rounded-full cursor-pointer ring-2 ${form.color === c ? 'ring-white ring-offset-1 ring-offset-background' : 'ring-transparent'}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
            {createError && <p className="text-sm text-danger">{createError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                Create Group
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Groups list */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Loading…
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center p-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <Layers className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">No device groups yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a group to organise your devices.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.id}>
                {/* Edit inline form */}
                {editId === g.id && editState ? (
                  <form onSubmit={saveEdit} className="space-y-3 p-4 bg-primary/5 border-b border-primary/20">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`eg-name-${g.id}`}>Name</Label>
                        <Input
                          id={`eg-name-${g.id}`}
                          required
                          value={editState.name}
                          onChange={(e) => setEditState((s) => s ? { ...s, name: e.target.value } : s)}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`eg-desc-${g.id}`}>Description</Label>
                        <Input
                          id={`eg-desc-${g.id}`}
                          value={editState.description}
                          onChange={(e) => setEditState((s) => s ? { ...s, description: e.target.value } : s)}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Color</Label>
                      <div className="flex gap-2">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setEditState((s) => s ? { ...s, color: c } : s)}
                            className={`w-4 h-4 rounded-full cursor-pointer ring-2 ${editState.color === c ? 'ring-white ring-offset-1 ring-offset-background' : 'ring-transparent'}`}
                            style={{ backgroundColor: c }}
                            aria-label={c}
                          />
                        ))}
                      </div>
                    </div>
                    {editError && <p className="text-xs text-danger">{editError}</p>}
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={editSubmitting}>
                        {editSubmitting
                          ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          : <Check className="h-3.5 w-3.5" />}
                        Save
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  /* Normal group row */
                  <div className="group flex items-center justify-between px-4 py-3 hover:bg-accent/50">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: g.color }}
                      />
                      <div>
                        <p className="text-sm font-semibold">{g.name}</p>
                        {g.description && (
                          <p className="text-xs text-muted-foreground">{g.description}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{g.deviceIds.length} devices</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openMembers(g)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        title="Manage devices"
                        aria-label="Manage devices"
                      >
                        <Users className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => startEdit(g)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        title="Edit"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(g)}
                        disabled={busy === g.id}
                        className="rounded p-1 text-muted-foreground hover:text-danger"
                        title="Delete"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Member assignment panel */}
                {memberGroupId === g.id && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assign devices to "{g.name}"</p>
                    {devices.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No devices found.</p>
                    ) : (
                      <ul className="space-y-1 max-h-60 overflow-y-auto">
                        {devices.map((d) => (
                          <li key={d.id}>
                            <label className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent cursor-pointer text-sm">
                              <input
                                type="checkbox"
                                className="accent-primary"
                                checked={memberSelection.has(d.id)}
                                onChange={() => toggleMember(d.id)}
                              />
                              <span className="font-medium">{d.name}</span>
                              <span className="font-mono text-xs text-muted-foreground">{d.imei}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveMembers} disabled={memberSaving}>
                        {memberSaving
                          ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          : <Check className="h-3.5 w-3.5" />}
                        Save members
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setMemberGroupId(null)}>
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
