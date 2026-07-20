import { cn } from '@/lib/utils';
import type { DeviceStatus } from '@/lib/types';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  );
}

const statusStyles: Record<DeviceStatus, { dot: string; label: string; text: string }> = {
  active: { dot: 'bg-success', label: 'Live', text: 'text-success' },
  inactive: { dot: 'bg-muted-foreground', label: 'Inactive', text: 'text-muted-foreground' },
  offline: { dot: 'bg-danger', label: 'Offline', text: 'text-danger' },
  maintenance: { dot: 'bg-warning', label: 'Service', text: 'text-warning' },
};

export function StatusBadge({ status }: { status: DeviceStatus }) {
  const s = statusStyles[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.text)}>
      <span className="relative flex h-2 w-2">
        {status === 'active' && (
          <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-75', s.dot, 'animate-pulse-ring')} />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', s.dot)} />
      </span>
      {s.label}
    </span>
  );
}
