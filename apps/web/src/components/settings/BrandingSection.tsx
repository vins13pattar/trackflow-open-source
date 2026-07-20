'use client';

import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { applyBrandColor } from '@/lib/branding';
import type { Branding } from '@/lib/types';

export function BrandingSection() {
  const [form, setForm] = useState<Branding>({ brandName: '', logoUrl: '', primaryColor: '#6366f1', customDomain: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getBranding()
      .then((b) =>
        setForm({
          brandName: b.brandName ?? '',
          logoUrl: b.logoUrl ?? '',
          primaryColor: b.primaryColor ?? '#6366f1',
          customDomain: b.customDomain ?? '',
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  const set = (k: keyof Branding) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateBranding({
        brandName: form.brandName || null,
        logoUrl: form.logoUrl || null,
        primaryColor: form.primaryColor || null,
        customDomain: form.customDomain || null,
      });
      applyBrandColor(updated.primaryColor);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading branding…
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h3 className="font-semibold">White-label branding</h3>
        <p className="text-sm text-muted-foreground">Customize the dashboard for your customers.</p>
      </div>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="b-name">Brand name</Label>
          <Input id="b-name" value={form.brandName ?? ''} onChange={set('brandName')} placeholder="Acme Track" />
        </div>
        <div>
          <Label htmlFor="b-color">Primary color</Label>
          <div className="flex gap-2">
            <input
              type="color"
              value={form.primaryColor ?? '#6366f1'}
              onChange={set('primaryColor')}
              className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background"
              aria-label="Primary color"
            />
            <Input value={form.primaryColor ?? ''} onChange={set('primaryColor')} placeholder="#6366f1" />
          </div>
        </div>
        <div>
          <Label htmlFor="b-logo">Logo URL</Label>
          <Input id="b-logo" type="url" value={form.logoUrl ?? ''} onChange={set('logoUrl')} placeholder="https://…/logo.png" />
        </div>
        <div>
          <Label htmlFor="b-domain">Custom domain</Label>
          <Input id="b-domain" value={form.customDomain ?? ''} onChange={set('customDomain')} placeholder="track.acme.com" />
          <p className="mt-1 text-xs text-muted-foreground">Point a CNAME here; served via Cloudflare for SaaS.</p>
        </div>
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
            {saved ? 'Saved' : 'Save branding'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
