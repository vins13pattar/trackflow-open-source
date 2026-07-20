import Link from 'next/link';

export const metadata = { title: 'Privacy Policy — TrackFlow' };

const sections: Array<{ h: string; p: string[] }> = [
  {
    h: '1. What we collect',
    p: [
      'Account data: name, email, password (stored as a salted hash — never in plain text), and workspace details.',
      'Tracking data: GPS positions, telemetry (ignition, battery, fuel, temperature and similar sensor values), trips and alerts produced by devices you connect or by the mobile app while you use it.',
      'Billing data: plan, invoices and payment references. Card/UPI details are processed by our payment providers (Razorpay, Stripe) and never touch our servers.',
      'Operational data: request logs with request IDs, audit logs of administrative actions, and delivery logs for notifications you configure.',
    ],
  },
  {
    h: '2. How we use it',
    p: [
      'Solely to provide the service: showing live positions, evaluating geofences, sending the alerts you configure, computing trips and reports, and billing your subscription.',
      'We do not sell personal data, and we do not use your tracking data for advertising or profiling.',
    ],
  },
  {
    h: '3. Tenant isolation & security',
    p: [
      'Every workspace is isolated with database-enforced row-level security, verified by automated tests on every release.',
      'Data is encrypted in transit (TLS) and at rest (managed database encryption). Access tokens are short-lived; refresh tokens rotate and revoke on reuse. Two-factor authentication is available to every account and can be required workspace-wide.',
    ],
  },
  {
    h: '4. Retention & deletion',
    p: [
      'Position history is retained according to your plan (7 days to unlimited) and purged automatically after that window.',
      'A workspace owner can export all workspace data as JSON and permanently delete the entire workspace from Settings → Security at any time. Deletion is immediate and irreversible; backups age out within the provider retention window.',
    ],
  },
  {
    h: '5. Your rights (DPDP Act 2023 / GDPR)',
    p: [
      'You can access, correct, export and erase your data — directly in the product (Settings → Security) or by emailing us. We respond to data-principal/data-subject requests within 30 days.',
      'Driver tracking: workspace owners are responsible for informing and obtaining any consent required from individuals whose vehicles or phones are tracked.',
    ],
  },
  {
    h: '6. Sub-processors',
    p: [
      'We use vetted infrastructure providers for hosting, database, email, SMS/WhatsApp delivery and payments. The current list is available on request and changes are announced in advance.',
    ],
  },
  {
    h: '7. Contact',
    p: ['Privacy questions and data requests: the support email of your TrackFlow operator, or the address on your invoice.'],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
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
