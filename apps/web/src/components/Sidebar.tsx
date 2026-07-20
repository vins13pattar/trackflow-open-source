'use client';

import { BarChart3, Bell, HelpCircle, Layers, MapPinned, Radio, Settings, Shapes, Truck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand } from './Brand';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/dashboard', label: 'Live Map', icon: MapPinned },
  { href: '/devices', label: 'Devices', icon: Radio },
  { href: '/vehicles', label: 'Vehicles', icon: Truck },
  { href: '/geofences', label: 'Geofences', icon: Shapes },
  { href: '/device-groups', label: 'Groups', icon: Layers },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/help', label: 'Help', icon: HelpCircle },
];

export function Sidebar({
  onNavigate,
  brandName,
  logoUrl,
  planLabel,
  planDetail,
}: {
  onNavigate?: () => void;
  brandName?: string;
  logoUrl?: string | null;
  planLabel?: string;
  planDetail?: string;
}) {
  const pathname = usePathname();
  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Brand name={brandName} logoUrl={logoUrl} />
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <Link href="/settings" onClick={onNavigate} className="block rounded-md bg-gradient-to-br from-indigo-500/10 to-violet-500/10 p-3 hover:from-indigo-500/20 hover:to-violet-500/20">
          <p className="text-xs font-semibold">{planLabel ?? '—'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{planDetail ?? 'Manage plan'}</p>
        </Link>
      </div>
    </aside>
  );
}
