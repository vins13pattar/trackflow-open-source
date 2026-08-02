/**
 * Scheduled report job. Builds a per-device trip/distance report over the last
 * 7 days as CSV + PDF, writes both out (R2 in production), and delivers a
 * summary over the notification channels (console in dev; email with
 * RESEND_API_KEY set).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, desc, devices, eq, gte, trips, withSystem } from '@trackflow/db';
import { buildRegistry, dispatch } from '@trackflow/notifications';
import { putObject, storageConfigured } from '@trackflow/storage';
import { db } from './db.js';
import { renderReportPdf, type ReportRow } from './report-pdf.js';

const REPORT_DIR = process.env.REPORT_DIR ?? path.join(os.tmpdir(), 'trackflow-reports');
const REPORT_EMAIL = process.env.REPORT_EMAIL;

export async function runReport(): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const fleet = await withSystem(db, 'system-job', (tx) =>
    tx.select({ id: devices.id, name: devices.name }).from(devices),
  );

  const rows: string[] = ['device,trips,distance_km,avg_speed_kph,speeding_samples'];
  const pdfRows: ReportRow[] = [];
  let fleetTrips = 0;
  let fleetDistance = 0;

  for (const d of fleet) {
    const t = await withSystem(db, 'system-job', (tx) =>
      tx.select().from(trips).where(and(eq(trips.deviceId, d.id), gte(trips.startedAt, since))).orderBy(desc(trips.startedAt)),
    );
    const distance = t.reduce((s, x) => s + x.distanceKm, 0);
    const speeding = t.reduce((s, x) => s + x.speedingSamples, 0);
    const avg = t.length ? t.reduce((s, x) => s + x.avgSpeedKph, 0) / t.length : 0;
    rows.push(`${JSON.stringify(d.name)},${t.length},${distance.toFixed(2)},${avg.toFixed(1)},${speeding}`);
    pdfRows.push({ device: d.name, trips: t.length, distanceKm: distance, avgSpeedKph: avg, speedingSamples: speeding });
    fleetTrips += t.length;
    fleetDistance += distance;
  }

  const csv = rows.join('\n');
  const dateKey = new Date().toISOString().slice(0, 10);
  const pdf = await renderReportPdf({
    title: 'TrackFlow weekly fleet report',
    periodLabel: `${since.toISOString().slice(0, 10)} — ${dateKey}`,
    rows: pdfRows,
    totals: { trips: fleetTrips, distanceKm: fleetDistance, devices: fleet.length },
  });

  const outputs: Array<{ filename: string; bytes: Buffer; contentType: string }> = [
    { filename: `fleet-${dateKey}.csv`, bytes: Buffer.from(csv, 'utf8'), contentType: 'text/csv' },
    { filename: `fleet-${dateKey}.pdf`, bytes: Buffer.from(pdf), contentType: 'application/pdf' },
  ];
  let archivedAt: string | null = null;
  for (const out of outputs) {
    if (storageConfigured()) {
      const url = await putObject(`reports/${dateKey}/${out.filename}`, out.bytes, out.contentType);
      archivedAt = archivedAt ?? url;
      console.log(`[report] archived to ${url}`);
    } else {
      await mkdir(REPORT_DIR, { recursive: true });
      const file = path.join(REPORT_DIR, out.filename);
      await writeFile(file, out.bytes);
      console.log(`[report] wrote ${file}`);
    }
  }

  const registry = buildRegistry({ resendApiKey: process.env.RESEND_API_KEY, emailFrom: process.env.EMAIL_FROM });
  const results = await dispatch(
    registry,
    REPORT_EMAIL ? ['console', 'email'] : ['console'],
    {
      alertId: 'report',
      title: 'TrackFlow weekly fleet report',
      body: `Last 7 days: ${fleetTrips} trips, ${fleetDistance.toFixed(1)} km across ${fleet.length} devices.${archivedAt ? `\n\nReport: ${archivedAt}` : ''}`,
      severity: 'info',
    },
    { emails: REPORT_EMAIL ? [REPORT_EMAIL] : [] },
  );
  console.log('[report] delivery:', results.map((r) => `${r.channel}:${r.status}`).join(', '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runReport().then(() => process.exit(0));
}
