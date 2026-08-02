'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { api } from '@/lib/api';
import { applyBrandColor } from '@/lib/branding';
import { useAuth } from '@/lib/auth';
import type { Branding, Subscription } from '@/lib/types';

const titles: Record<string, string> = {
  '/dashboard': 'Live Map',
  '/devices': 'Devices',
  '/vehicles': 'Vehicles',
  '/geofences': 'Geofences',
  '/device-groups': 'Device Groups',
  '/alerts': 'Alerts',
  '/reports': 'Reports',
  '/settings': 'Settings',
  '/help': 'Help',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  useEffect(() => {
    if (!user) return;
    api
      .getBranding()
      .then((b) => {
        setBranding(b);
        applyBrandColor(b.primaryColor);
      })
      .catch(() => {});
  }, [user]);

  // Refetch the plan on navigation so the sidebar reflects upgrades made in Settings.
  useEffect(() => {
    if (!user) return;
    api.getSubscription().then(setSub).catch(() => {});
  }, [user, pathname]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const title =
    titles[pathname] ?? Object.entries(titles).find(([k]) => pathname.startsWith(k))?.[1] ?? 'TrackFlow';

  const planLabel = sub ? `${sub.planName} plan` : undefined;
  const planDetail = sub
    ? sub.limits.devices < 0
      ? `${sub.usage.devices} devices`
      : `${sub.usage.devices} / ${sub.limits.devices} devices`
    : undefined;
  const sidebarProps = {
    brandName: branding?.brandName ?? undefined,
    logoUrl: branding?.logoUrl,
    planLabel,
    planDetail,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden lg:block">
        <Sidebar {...sidebarProps} />
      </div>
      {mobileOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
          />
          <div
            id="mobile-navigation"
            className="fixed inset-y-0 left-0 z-50 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <Sidebar
              onNavigate={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
              {...sidebarProps}
            />
          </div>
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenu={() => setMobileOpen(true)} menuOpen={mobileOpen} />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
