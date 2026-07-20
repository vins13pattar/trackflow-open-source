import { Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Brand({
  className,
  showText = true,
  name = 'TrackFlow',
  logoUrl,
}: {
  className?: string;
  showText?: boolean;
  name?: string;
  logoUrl?: string | null;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={name} className="h-9 w-9 rounded-lg object-contain" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-primary/30">
          <Navigation className="h-5 w-5 -rotate-45 text-white" fill="currentColor" />
        </div>
      )}
      {showText && <span className="text-lg font-semibold tracking-tight">{name}</span>}
    </div>
  );
}
