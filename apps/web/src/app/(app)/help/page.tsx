import { API_BASE, INGEST_HOST, PROTOCOL_PORTS } from '@/lib/api';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

const toc = [
  ['quickstart', 'Quick start'],
  ['add-device', 'Add a device'],
  ['connect', 'Connect a tracker'],
  ['no-hardware', 'Test without hardware'],
  ['features', 'Features'],
  ['troubleshooting', 'Troubleshooting'],
] as const;

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <h2 className="text-xl font-semibold">Help & guide</h2>
      <p className="mt-1 text-sm text-muted-foreground">Everything you need to run your fleet on TrackFlow.</p>

      <nav className="my-5 flex flex-wrap gap-2">
        {toc.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        <Section id="quickstart" title="Quick start">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Add a device under <strong>Devices</strong> (name + 15-digit IMEI + protocol).</li>
            <li>Point the tracker at your server (see <a className="text-primary hover:underline" href="#connect">Connect a tracker</a>).</li>
            <li>Watch it on the <strong>Live Map</strong>; create geofences and alerts as needed.</li>
          </ol>
        </Section>

        <Section id="add-device" title="Add a device">
          <p>
            <strong>Devices → Add device.</strong> Enter a name (e.g. the plate), the device's 15-digit IMEI (on the
            device/box), its type, and protocol. New devices are <strong>Active</strong> but show as Offline until they
            report. The IMEI must match exactly — it's how incoming data is routed.
          </p>
        </Section>

        <Section id="connect" title="Connect a tracker">
          <p>Configure the tracker to send to your TrackFlow ingest server on the port for its protocol:</p>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5">Protocol</th>
                <th>Server host</th>
                <th>Port</th>
                <th>Typical devices</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {([
                ['gt06', 'Concox / most budget trackers'],
                ['h02', 'Budget / personal trackers'],
                ['teltonika', 'Teltonika FMB/FMC'],
                ['nmea', 'Raw GPS modules'],
              ] as const).map(([proto, devices]) => (
                <tr key={proto} className="border-b border-border/50">
                  <td className="py-1.5 uppercase">{proto}</td>
                  <td>{INGEST_HOST}</td>
                  <td>{PROTOCOL_PORTS[proto]}</td>
                  <td className="font-sans">{devices}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">
            Each device's row has a <strong>Connect</strong> button with copy-paste setup (including a sample SMS for
            Concox/GT06). Most trackers are configured by SMS to the SIM in the device.
          </p>
        </Section>

        <Section id="no-hardware" title="Test without hardware">
          <p>No tracker yet? Three options:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Simulator</strong> — replays a moving device: <code className="rounded bg-muted px-1">pnpm --filter @trackflow/ingest sim gt06 &lt;imei&gt;</code></li>
            <li><strong>Seed a demo fleet</strong> — several devices moving at once (<code className="rounded bg-muted px-1">… seed</code>).</li>
            <li><strong>Your phone</strong> — the TrackFlow mobile app reports your real GPS.</li>
          </ul>
        </Section>

        <Section id="features" title="Features">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Live Map</strong> — real-time positions, heading, speed, telemetry (ignition, battery, temperature…), and track playback.</li>
            <li><strong>Geofences</strong> — draw zones; get entry/exit alerts; enable/disable any time.</li>
            <li><strong>Alerts</strong> — live feed; acknowledge; delivered via email/SMS/push/webhook.</li>
            <li><strong>Reports</strong> — trips, distance, driver score, CSV export.</li>
            <li><strong>Settings</strong> — team & roles, API keys, webhooks, billing & invoices, white-label branding.</li>
            <li>
              <strong>API</strong> — full REST reference at{' '}
              <a className="text-primary hover:underline" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
                {API_BASE}/docs
              </a>{' '}
              (authenticate with an API key from Settings).
            </li>
          </ul>
        </Section>

        <Section id="troubleshooting" title="Troubleshooting — device not showing up?">
          <ol className="list-decimal space-y-1 pl-5">
            <li>IMEI must exactly match the one you entered.</li>
            <li>Confirm the tracker points at the right host and protocol port.</li>
            <li>Check the SIM has data and the correct APN.</li>
            <li>If creation was blocked, you've hit your plan's device limit — upgrade in Settings.</li>
            <li>Make sure the device's protocol matches the one selected.</li>
          </ol>
        </Section>
      </div>
    </div>
  );
}
