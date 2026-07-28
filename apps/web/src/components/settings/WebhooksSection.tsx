'use client';

import { ChevronDown, ChevronRight, Loader2, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { type WebhookDeliveryEntry, type WebhookSummary, WEBHOOK_EVENTS } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

export function WebhooksSection() {
  const [hooks, setHooks] = useState<WebhookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['alert.triggered']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDeliveryEntry[]>>({});
  const [loadingDel, setLoadingDel] = useState<string | null>(null);

  const load = () =>
    api
      .listWebhooks()
      .then((r) => setHooks(r.webhooks))
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  const toggle = (e: string) =>
    setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (events.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createWebhook({ name, url, events });
      setNewSecret(created.secret ?? null);
      setName('');
      setUrl('');
      setEvents(['alert.triggered']);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function test(id: string) {
    setTested((t) => ({ ...t, [id]: 'sending…' }));
    try {
      const r = await api.testWebhook(id);
      setTested((t) => ({ ...t, [id]: r.ok ? `delivered (${r.status})` : `failed: ${r.error}` }));
      await load();
    } catch (err) {
      setTested((t) => ({ ...t, [id]: (err as Error).message }));
    }
  }

  async function toggleDeliveries(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (deliveries[id]) return; // already loaded
    setLoadingDel(id);
    try {
      const r = await api.listWebhookDeliveries(id, { limit: 10 });
      setDeliveries((d) => ({ ...d, [id]: r.deliveries }));
    } catch {
      // swallow; empty array will show "no deliveries"
      setDeliveries((d) => ({ ...d, [id]: [] }));
    } finally {
      setLoadingDel(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h3 className="font-semibold">Webhooks</h3>
        <p className="text-sm text-muted-foreground">Receive signed event callbacks (HMAC-SHA256).</p>
      </div>

      <form onSubmit={create} className="mb-5 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="w-name">Name</Label>
            <Input id="w-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops integration" />
          </div>
          <div>
            <Label htmlFor="w-url">Endpoint URL</Label>
            <Input id="w-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {WEBHOOK_EVENTS.map((ev) => (
            <button
              type="button"
              key={ev}
              onClick={() => toggle(ev)}
              className={
                'rounded-full border px-3 py-1 text-xs font-medium ' +
                (events.includes(ev) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent')
              }
            >
              {ev}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {newSecret && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-medium">Copy this signing secret now. It will not be shown again.</p>
            <code className="mt-1 block break-all text-xs">{newSecret}</code>
          </div>
        )}
        <Button type="submit" disabled={submitting || events.length === 0}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add webhook
        </Button>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : hooks.length === 0 ? (
        <div className="flex flex-col items-center rounded-md border border-dashed border-border py-8 text-center">
          <Webhook className="mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No webhooks yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {hooks.map((w) => (
            <li key={w.id} className="rounded-md border border-border">
              <div className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{w.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{w.url}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{w.events.join(', ')}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="text-success">{w.successCount} ok</span>
                    {w.failureCount > 0 && <span className="text-danger">{w.failureCount} failed</span>}
                    {w.lastSuccessAt && <span>last {timeAgo(w.lastSuccessAt)}</span>}
                    {tested[w.id] && <span className="ml-auto font-medium">{tested[w.id]}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => test(w.id)}>
                    <Send className="h-3.5 w-3.5" /> Test
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => api.deleteWebhook(w.id).then(load)} aria-label="Delete">
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </div>

              {/* Delivery log toggle */}
              <button
                onClick={() => toggleDeliveries(w.id)}
                className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
              >
                {expanded === w.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Recent deliveries
              </button>

              {expanded === w.id && (
                <div className="border-t border-border">
                  {loadingDel === w.id ? (
                    <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </div>
                  ) : !deliveries[w.id] || (deliveries[w.id]?.length ?? 0) === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">No deliveries yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {(deliveries[w.id] ?? []).map((d) => (
                        <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                          <span
                            className={
                              'w-14 shrink-0 rounded px-1.5 py-0.5 text-center font-medium ' +
                              (d.status === 'success'
                                ? 'bg-success/15 text-success'
                                : d.status === 'pending'
                                  ? 'bg-warning/15 text-warning'
                                  : 'bg-danger/15 text-danger')
                            }
                          >
                            {d.status}
                          </span>
                          <span className="truncate font-mono text-muted-foreground">{d.event}</span>
                          {d.httpStatus && (
                            <span className="shrink-0 text-muted-foreground">HTTP {d.httpStatus}</span>
                          )}
                          <span className="ml-auto shrink-0 text-muted-foreground">{timeAgo(d.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
