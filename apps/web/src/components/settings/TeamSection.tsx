'use client';

import { Loader2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { TeamMember } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SecretReveal } from './SecretReveal';

const roles = ['admin', 'manager', 'user', 'viewer'] as const;

const roleStyles: Record<string, string> = {
  owner: 'bg-primary/15 text-primary',
  admin: 'bg-violet-500/15 text-violet-400',
  manager: 'bg-sky-500/15 text-sky-400',
  user: 'bg-muted text-muted-foreground',
  viewer: 'bg-muted text-muted-foreground',
};

export function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', name: '', role: 'user' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const load = () =>
    api
      .listUsers()
      .then((r) => setMembers(r.users))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.inviteUser(form);
      setTempPassword(res.tempPassword);
      setForm({ email: '', name: '', role: 'user' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Team members</h3>
          <p className="text-sm text-muted-foreground">Invite teammates and assign roles.</p>
        </div>
      </div>

      {tempPassword && (
        <div className="mb-4">
          <SecretReveal label="Temporary password for the invited user" value={tempPassword} onDismiss={() => setTempPassword(null)} />
        </div>
      )}

      <form onSubmit={invite} className="mb-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div>
          <Label htmlFor="t-name">Name</Label>
          <Input id="t-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ravi K." />
        </div>
        <div>
          <Label htmlFor="t-email">Email</Label>
          <Input id="t-email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="ravi@acme.in" />
        </div>
        <div>
          <Label htmlFor="t-role">Role</Label>
          <select id="t-role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Invite
        </Button>
      </form>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium capitalize', roleStyles[m.role] ?? roleStyles.user)}>
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
