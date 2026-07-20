import { PDFDocument, type PDFFont, type PDFPage, type RGB, StandardFonts, rgb } from 'pdf-lib';

export interface ReportRow {
  device: string;
  trips: number;
  distanceKm: number;
  avgSpeedKph: number;
  speedingSamples: number;
}

export interface ReportPdfData {
  title: string;
  periodLabel: string; // e.g. "2026-06-05 — 2026-06-12"
  rows: ReportRow[];
  totals: { trips: number; distanceKm: number; devices: number };
}

// Standard PDF fonts use WinAnsi; drop anything outside printable ASCII so an
// exotic device name can never crash report generation (same as invoice-pdf).
const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const ROW_H = 18;

/** Renders the fleet report as a paginated A4 PDF table. */
export async function renderReportPdf(data: ReportPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(data.title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  const line = rgb(0.8, 0.8, 0.84);

  const cols = [
    { label: 'Device', x: MARGIN, align: 'left' as const },
    { label: 'Trips', x: 330, align: 'right' as const },
    { label: 'Distance (km)', x: 410, align: 'right' as const },
    { label: 'Avg speed', x: 480, align: 'right' as const },
    { label: 'Speeding', x: A4[0] - MARGIN, align: 'right' as const },
  ];

  let page: PDFPage;
  let y = 0;

  const text = (p: PDFPage, s: string, x: number, yy: number, f: PDFFont, size: number, color: RGB, alignRight = false) => {
    const clean = safe(s);
    const drawX = alignRight ? x - f.widthOfTextAtSize(clean, size) : x;
    p.drawText(clean, { x: drawX, y: yy, size, font: f, color });
  };

  const header = (p: PDFPage) => {
    let yy = A4[1] - MARGIN;
    text(p, data.title, MARGIN, yy, bold, 16, ink);
    yy -= 18;
    text(p, data.periodLabel, MARGIN, yy, font, 10, muted);
    yy -= 28;
    for (const c of cols) text(p, c.label, c.x, yy, bold, 9, muted, c.align === 'right');
    yy -= 6;
    p.drawLine({ start: { x: MARGIN, y: yy }, end: { x: A4[0] - MARGIN, y: yy }, thickness: 0.7, color: line });
    return yy - ROW_H;
  };

  const newPage = () => {
    page = doc.addPage(A4);
    y = header(page);
  };
  newPage();

  for (const r of data.rows) {
    if (y < MARGIN + 40) newPage();
    const cells = [
      r.device.length > 48 ? `${r.device.slice(0, 47)}…` : r.device,
      String(r.trips),
      r.distanceKm.toFixed(1),
      r.avgSpeedKph.toFixed(1),
      String(r.speedingSamples),
    ];
    cells.forEach((cell, i) => text(page, cell, cols[i]!.x, y, font, 9.5, ink, cols[i]!.align === 'right'));
    y -= ROW_H;
  }

  // Totals strip.
  if (y < MARGIN + 40) newPage();
  page!.drawLine({ start: { x: MARGIN, y: y + ROW_H - 6 }, end: { x: A4[0] - MARGIN, y: y + ROW_H - 6 }, thickness: 0.7, color: line });
  text(page!, `Fleet total — ${data.totals.devices} devices`, MARGIN, y, bold, 9.5, ink);
  text(page!, String(data.totals.trips), cols[1]!.x, y, bold, 9.5, ink, true);
  text(page!, data.totals.distanceKm.toFixed(1), cols[2]!.x, y, bold, 9.5, ink, true);

  return doc.save();
}
