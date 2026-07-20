'use client';

import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { ApiKeySummary } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { SecretReveal } from './SecretReveal';

const SCOPES = [
  'devices:read',
  'devices:write',
  'geofences:read',
  'geofences:write',
  'alerts:read',
  'analytics:read',
  'reports:read',
  'users:manage',
  'webhooks:read',
  'webhooks:write',
  'billing:read',
  'scim:provision',
];

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['devices:read']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = () =>
    api
      .listApiKeys()
      .then((r) => setKeys(r.keys))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  const toggleScope = (s: string) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (scopes.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createApiKey({ name, scopes });
      setNewKey(res.key);
      setName('');
      setScopes(['devices:read']);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    await api.revokeApiKey(id);
    await load();
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h3 className="font-semibold">API keys</h3>
        <p className="text-sm text-muted-foreground">Programmatic access with scoped permissions.</p>
      </div>

      {newKey && (
        <div className="mb-4">
          <SecretReveal label="Your new API key" value={newKey} onDismiss={() => setNewKey(null)} />
        </div>
      )}

      <form onSubmit={create} className="mb-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="k-name">Key name</Label>
            <Input id="k-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Production integration" />
          </div>
          <Button type="submit" disabled={submitting || scopes.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create key
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => toggleScope(s)}
              className={
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                (scopes.includes(s)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent')
              }
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center rounded-md border border-dashed border-border py-8 text-center">
          <KeyRound className="mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{k.name}</p>
                  {k.revokedAt && <span className="rounded bg-danger/15 px-1.5 py-0.5 text-xs text-danger">revoked</span>}
                </div>
                <p className="font-mono text-xs text-muted-foreground">{k.prefix}… · {k.scopes.join(', ')}</p>
                <p className="text-xs text-muted-foreground">Last used {timeAgo(k.lastUsedAt)}</p>
              </div>
              {!k.revokedAt && (
                <Button variant="ghost" size="icon" onClick={() => revoke(k.id)} aria-label="Revoke key">
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
