import type { LucideIcon } from 'lucide-react';

export function ComingSoon({
  icon: Icon,
  title,
  description,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15">
          <Icon className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <span className="mt-4 inline-block rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {phase}
        </span>
      </div>
    </div>
  );
}
