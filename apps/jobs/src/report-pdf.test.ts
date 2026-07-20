import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderReportPdf, type ReportRow } from './report-pdf.js';

const row = (i: number): ReportRow => ({
  device: `Truck ${i}`,
  trips: i,
  distanceKm: i * 12.3,
  avgSpeedKph: 40 + i,
  speedingSamples: i % 3,
});

describe('renderReportPdf', () => {
  it('produces a valid single-page PDF for a small fleet', async () => {
    const bytes = await renderReportPdf({
      title: 'TrackFlow weekly fleet report',
      periodLabel: '2026-06-05 — 2026-06-12',
      rows: [row(1), row(2), row(3)],
      totals: { trips: 6, distanceKm: 73.8, devices: 3 },
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('TrackFlow weekly fleet report');
  });

  it('paginates a large fleet and survives exotic device names', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i));
    rows[0]!.device = 'ट्रक १ — फ्लीट 🛻 with a very long name that should be truncated safely';
    const bytes = await renderReportPdf({
      title: 'Big fleet',
      periodLabel: 'period',
      rows,
      totals: { trips: 1, distanceKm: 1, devices: 120 },
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
