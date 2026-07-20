'use client';

import { Check, Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { api, downloadInvoicePdf } from '@/lib/api';
import { startCheckout } from '@/lib/razorpay';
import type { InvoiceSummary, Plan, Subscription } from '@/lib/types';
import { cn } from '@/lib/utils';

const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, professional: 2, enterprise: 3 };
const fmt = (n: number) => (n < 0 ? '∞' : String(n));

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit < 0 ? 12 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const full = limit >= 0 && used >= limit;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-medium', full && 'text-danger')}>
          {used} / {fmt(limit)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className={cn('h-1.5 rounded-full', full ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BillingSection() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.getSubscription(), api.listInvoices(), api.getPlans()])
      .then(([s, i, p]) => {
        setSub(s);
        setInvoices(i.invoices);
        // Selectable upgrade/switch targets come from the DB catalog (public, non-free).
        setPlans(p.plans.filter((plan) => plan.isPublic && plan.key !== 'free'));
      })
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  async function changePlan(plan: string, downgrade: boolean) {
    setUpgrading(plan);
    setError(null);
    try {
      if (downgrade) await api.downgradePlan(plan);
      else await startCheckout(plan);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpgrading(null);
    }
  }

  async function cancel() {
    setCanceling(true);
    setError(null);
    try {
      await api.cancelSubscription();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading billing…
      </Card>
    );
  }

  const currentRank = PLAN_RANK[sub?.plan ?? 'free'] ?? 0;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Plan & billing</h3>
          <p className="text-sm text-muted-foreground">
            You’re on the <span className="font-medium capitalize text-foreground">{sub?.planName}</span> plan
            {sub?.status === 'trialing' && ' (trial)'}.
          </p>
        </div>
        {sub && sub.plan !== 'free' && sub.status !== 'canceled' && (
          <Button variant="outline" size="sm" disabled={canceling} onClick={() => void cancel()}>
            {canceling && <Loader2 className="h-4 w-4 animate-spin" />} Cancel plan
          </Button>
        )}
      </div>

      {sub?.status === 'trialing' && sub.trialDaysLeft != null && (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          {sub.trialDaysLeft > 0
            ? `${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? '' : 's'} left in your ${sub.planName} trial.`
            : 'Your trial ends today — add a plan to keep your data and limits.'}
        </div>
      )}
      {sub?.status === 'canceled' && (
        <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Subscription canceled — access continues until the end of your billing period, then reverts to Free.
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <UsageBar label="Devices" used={sub?.usage.devices ?? 0} limit={sub?.limits.devices ?? 1} />
        <UsageBar label="Users" used={sub?.usage.users ?? 0} limit={sub?.limits.users ?? 1} />
        <UsageBar
          label="API calls (this month)"
          used={sub?.usage.apiCalls ?? 0}
          limit={sub?.limits.apiCallsPerMonth ?? 0}
        />
        <div className="flex items-end text-xs text-muted-foreground">
          SMS sent this month:{' '}
          <span className="ml-1 font-medium text-foreground">{sub?.usage.smsSent ?? 0}</span>
        </div>
      </div>

      {sub && sub.overages.totalInr > 0 && (
        <div className="mb-5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">Pending usage charges this period: ₹{sub.overages.totalInr}</span>
          <span className="text-muted-foreground">
            {' — '}
            {sub.overages.items
              .filter((i) => i.overage > 0)
              .map((i) => `${i.overage} ${i.resource}`)
              .join(', ')}{' '}
            over your plan’s included quota.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = sub?.plan === p.key;
          const isDowngrade = (PLAN_RANK[p.key] ?? 0) < currentRank;
          const isEnterprise = p.key === 'enterprise';
          return (
            <div key={p.key} className={cn('rounded-lg border p-4', isCurrent ? 'border-primary bg-primary/5' : 'border-border')}>
              <p className="font-semibold">{p.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{p.priceInr ? `₹${p.priceInr}/mo` : 'Custom'}</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>{fmt(p.limits.devices)} devices</li>
                <li>{fmt(p.limits.users)} users</li>
              </ul>
              <div className="mt-3">
                {isCurrent ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <Check className="h-3.5 w-3.5" /> Current plan
                  </span>
                ) : isEnterprise ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Contact sales
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={isDowngrade ? 'outline' : 'primary'}
                    className="w-full"
                    disabled={upgrading !== null}
                    onClick={() => changePlan(p.key, isDowngrade)}
                  >
                    {upgrading === p.key && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isDowngrade ? 'Switch' : 'Upgrade'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {invoices.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-medium">Invoices</h4>
          <ul className="divide-y divide-border rounded-md border border-border">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <span className="font-mono text-xs">{inv.number}</span>
                  <span className="ml-2 capitalize text-muted-foreground">{inv.plan}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    ₹{inv.totalInr} <span className="text-xs">(incl. ₹{inv.taxInr} GST)</span>
                  </span>
                  <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs text-success capitalize">{inv.status}</span>
                  <button
                    type="button"
                    onClick={() => void downloadInvoicePdf(inv.id, inv.number)}
                    title="Download GST invoice (PDF)"
                    aria-label={`Download invoice ${inv.number}`}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
