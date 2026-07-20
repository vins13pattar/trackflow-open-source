'use client';

import { Check, Copy, Download, Loader2, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card } from '@/components/ui/misc';
import { api, downloadWorkspaceExport, type MfaStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function SecuritySection() {
  const { user, logout } = useAuth();
  const canManageTeam = !!user && ['owner', 'admin'].includes(user.role);
  const isOwner = user?.role === 'owner';

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Enrollment state — secret shown once, then code confirmation, then the
  // one-time recovery codes.
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const [copied, setCopied] = useState(false);

  const load = () =>
    api
      .mfaStatus()
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () =>
    run(async () => {
      setSetup(await api.mfaSetup());
      setCode('');
    });

  const confirmEnable = () =>
    run(async () => {
      const res = await api.mfaEnable(code);
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setCode('');
      await load();
    });

  const disable = () =>
    run(async () => {
      await api.mfaDisable(disableCode);
      setDisableCode('');
      setRecoveryCodes(null);
      await load();
    });

  const toggleRequirement = () =>
    run(async () => {
      await api.setMfaRequirement(!status?.requiredByTenant);
      await load();
    });

  async function copyAll(values: string[]) {
    await navigator.clipboard.writeText(values.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h3 className="font-semibold">Security</h3>
        <p className="text-sm text-muted-foreground">Two-factor authentication for your account.</p>
      </div>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {!status ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-5">
          {/* One-time recovery codes, shown only right after enabling. */}
          {recoveryCodes && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-4">
              <p className="text-sm font-medium">Recovery codes — save them now, they will not be shown again.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Each code signs you in once if you lose your authenticator.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
                {recoveryCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyAll(recoveryCodes)}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRecoveryCodes(null)}>
                  I saved them
                </Button>
              </div>
            </div>
          )}

          {status.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-success" />
                <span className="font-medium">Two-factor authentication is on.</span>
                <span className="text-muted-foreground">
                  {status.recoveryCodesRemaining} recovery {status.recoveryCodesRemaining === 1 ? 'code' : 'codes'} left
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="mfa-disable-code">Code (to turn off)</Label>
                  <Input
                    id="mfa-disable-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456 or recovery code"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                  />
                </div>
                <Button variant="outline" disabled={busy || disableCode.length < 6} onClick={disable}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
                  Turn off 2FA
                </Button>
              </div>
            </div>
          ) : setup ? (
            <div className="space-y-3">
              <p className="text-sm">
                Add this secret to your authenticator app (Google Authenticator, 1Password, Authy…), then enter the
                6-digit code it shows.
              </p>
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Secret (manual entry)</p>
                <p className="break-all font-mono text-sm">{setup.secret}</p>
                <a href={setup.otpauthUri} className="mt-1 inline-block text-xs text-primary hover:underline">
                  Open in authenticator app
                </a>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="mfa-code">6-digit code</Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <Button disabled={busy || code.length < 6} onClick={confirmEnable}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm & enable
                </Button>
                <Button variant="ghost" onClick={() => setSetup(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Two-factor authentication is off.</p>
                <p className="text-sm text-muted-foreground">
                  Protect your account with a one-time code at sign-in.
                  {status.requiredByTenant && (
                    <span className="text-warning"> Your workspace requires 2FA — please enable it.</span>
                  )}
                </p>
              </div>
              <Button disabled={busy} onClick={startSetup}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Enable 2FA
              </Button>
            </div>
          )}

          {canManageTeam && (
            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium">Require 2FA for the workspace</p>
                <p className="text-sm text-muted-foreground">
                  Members without 2FA are prompted to enable it when they sign in.
                </p>
              </div>
              <Button variant={status.requiredByTenant ? 'outline' : 'primary'} disabled={busy} onClick={toggleRequirement}>
                {status.requiredByTenant ? 'Required — turn off' : 'Require 2FA'}
              </Button>
            </div>
          )}

          {isOwner && (
            <div className="space-y-4 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Export workspace data</p>
                  <p className="text-sm text-muted-foreground">
                    Everything we hold about this workspace as JSON (DPDP/GDPR data portability).
                  </p>
                </div>
                <Button variant="outline" disabled={busy} onClick={() => run(downloadWorkspaceExport)}>
                  <Download className="h-4 w-4" /> Export
                </Button>
              </div>

              {!showDelete ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-danger">Delete workspace</p>
                    <p className="text-sm text-muted-foreground">
                      Permanently removes every device, position, member and invoice. Irreversible.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setShowDelete(true)}>
                    <Trash2 className="h-4 w-4 text-danger" /> Delete…
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border border-danger/40 bg-danger/5 p-4">
                  <p className="text-sm font-medium text-danger">This cannot be undone.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Export your data first. Then enter your password and type{' '}
                    <span className="font-mono">delete my workspace</span> to confirm.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="del-password">Your password</Label>
                      <Input
                        id="del-password"
                        type="password"
                        autoComplete="current-password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="del-confirm">Confirmation phrase</Label>
                      <Input
                        id="del-confirm"
                        placeholder="delete my workspace"
                        value={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="danger"
                      disabled={busy || !deletePassword || deleteConfirm !== 'delete my workspace'}
                      onClick={() =>
                        run(async () => {
                          await api.deleteWorkspace({ password: deletePassword, confirm: deleteConfirm });
                          logout();
                        })
                      }
                    >
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Permanently delete
                    </Button>
                    <Button variant="ghost" onClick={() => setShowDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
