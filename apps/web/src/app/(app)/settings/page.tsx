import { BookOpen, ExternalLink } from 'lucide-react';
import { ApiKeysSection } from '@/components/settings/ApiKeysSection';
import { BillingSection } from '@/components/settings/BillingSection';
import { BrandingSection } from '@/components/settings/BrandingSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { TeamSection } from '@/components/settings/TeamSection';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { API_BASE } from '@/lib/api';

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold">Workspace settings</h2>
        <p className="text-sm text-muted-foreground">Plan, team, integrations and branding.</p>
      </div>
      <BillingSection />
      <SecuritySection />
      <TeamSection />

      {/* Developer section header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">Developer</h3>
        <a
          href={`${API_BASE}/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <BookOpen className="h-3.5 w-3.5" />
          API reference
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      </div>
      <ApiKeysSection />
      <WebhooksSection />

      <BrandingSection />
    </div>
  );
}
