import Link from 'next/link';

export const metadata = { title: 'Terms of Service — TrackFlow' };

const sections: Array<{ h: string; p: string[] }> = [
  {
    h: '1. The service',
    p: [
      'TrackFlow provides multi-tenant GPS tracking: device ingestion, live maps, geofencing, alerts, trips, reports, APIs and related features, on the plan you subscribe to.',
    ],
  },
  {
    h: '2. Your account & acceptable use',
    p: [
      'You are responsible for safeguarding credentials and for all activity in your workspace. Track only vehicles, assets and people you are legally entitled to track, with any consent the law requires.',
      'No abuse: no unlawful tracking, no attempts to breach tenant isolation, no resale of the service except under a white-label agreement.',
    ],
  },
  {
    h: '3. Plans, billing & taxes',
    p: [
      'Subscriptions renew per the billing cycle you choose. Quotas (devices, users, history, API calls) follow your plan version; metered usage above included units is billed at the published rates.',
      'Prices are exclusive of taxes; GST is itemized on invoices where applicable. Downgrades apply at the next period when usage fits the target plan; cancellation keeps paid access until the period ends.',
    ],
  },
  {
    h: '4. Data',
    p: [
      'Your data remains yours. We process it only to provide the service, as described in the Privacy Policy. You can export it and delete your workspace at any time.',
    ],
  },
  {
    h: '5. Availability & support',
    p: [
      'We target the service levels published for your plan. Planned maintenance is announced in advance; incidents are reported on the status page.',
    ],
  },
  {
    h: '6. Liability',
    p: [
      'The service is provided as-is to the maximum extent permitted by law; our aggregate liability is capped at the fees paid in the preceding 12 months. TrackFlow is not a safety-of-life system and must not be the sole safeguard for any safety-critical decision.',
    ],
  },
  {
    h: '7. Changes & termination',
    p: [
      'We may update these terms with notice; continued use is acceptance. Either party may terminate — on termination you can export your data before deletion.',
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 12 June 2026</p>
      <div className="mt-8 space-y-8">
        {sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-semibold">{s.h}</h2>
            {s.p.map((para) => (
              <p key={para.slice(0, 40)} className="mt-2 text-sm leading-6 text-muted-foreground">
                {para}
              </p>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-10 text-sm">
        <Link href="/" className="text-primary hover:underline">
          ← Back to TrackFlow
        </Link>
      </p>
    </main>
  );
}
