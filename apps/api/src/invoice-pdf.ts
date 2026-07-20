import type { Invoice } from '@trackflow/db';
import { PDFDocument, type PDFFont, type RGB, StandardFonts, rgb } from 'pdf-lib';
import { env } from './env.js';

export interface InvoicePdfData {
  invoice: Pick<
    Invoice,
    | 'number'
    | 'plan'
    | 'billingCycle'
    | 'subtotalInr'
    | 'taxInr'
    | 'totalInr'
    | 'status'
    | 'createdAt'
    | 'periodStart'
    | 'periodEnd'
    | 'lineItems'
    | 'provider'
    | 'providerRef'
  >;
  tenantName: string;
}

/** Intra-state GST split (CGST + SGST sum exactly to the stored tax). */
export function gstBreakdown(taxInr: number): { cgst: number; sgst: number } {
  const cgst = Math.floor(taxInr / 2);
  return { cgst, sgst: taxInr - cgst };
}

const money = (n: number) => `INR ${n.toLocaleString('en-IN')}`;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
// Standard PDF fonts use WinAnsi; drop anything outside printable ASCII so an
// exotic tenant name can never crash invoice generation.
const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');

interface TextOpts {
  size?: number;
  font?: PDFFont;
  color?: RGB;
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const { invoice, tenantName } = data;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.number}`);
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const margin = 50;
  const right = width - margin;
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  const line = rgb(0.8, 0.8, 0.84);

  const text = (s: string, x: number, y: number, o: TextOpts = {}) =>
    page.drawText(safe(s), { x, y, size: o.size ?? 10, font: o.font ?? font, color: o.color ?? ink });
  const textRight = (s: string, xRight: number, y: number, o: TextOpts = {}) => {
    const f = o.font ?? font;
    const sz = o.size ?? 10;
    text(s, xRight - f.widthOfTextAtSize(safe(s), sz), y, o);
  };
  const hr = (x1: number, x2: number, y: number, thickness = 1) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: line });

  // Header: seller (left) + "TAX INVOICE" (right).
  text(env.invoice.sellerName, margin, 800, { size: 18, font: bold });
  textRight('TAX INVOICE', right, 800, { size: 16, font: bold, color: muted });
  let y = 782;
  for (const ln of env.invoice.sellerAddress.split('\n').filter(Boolean)) {
    text(ln, margin, y, { size: 9, color: muted });
    y -= 12;
  }
  if (env.invoice.sellerGstin) {
    text(`GSTIN: ${env.invoice.sellerGstin}`, margin, y, { size: 9, color: muted });
    y -= 12;
  }
  if (env.invoice.sellerState) {
    text(`State: ${env.invoice.sellerState}`, margin, y, { size: 9, color: muted });
    y -= 12;
  }

  // Invoice meta (right column).
  let my = 778;
  textRight(`Invoice ${invoice.number}`, right, my, { size: 10, font: bold });
  my -= 14;
  textRight(`Date: ${day(invoice.createdAt)}`, right, my, { size: 9, color: muted });
  my -= 12;
  textRight(`Status: ${invoice.status.toUpperCase()}`, right, my, { size: 9, color: muted });
  my -= 12;
  if (invoice.providerRef) {
    textRight(`Ref: ${invoice.provider ?? ''}/${invoice.providerRef}`, right, my, { size: 8, color: muted });
  }

  // Bill to.
  y = Math.min(y, 712) - 8;
  text('BILL TO', margin, y, { size: 9, font: bold, color: muted });
  y -= 15;
  text(tenantName, margin, y, { size: 11 });
  y -= 26;
  text(
    `Billing period: ${day(invoice.periodStart)} to ${day(invoice.periodEnd)} (${invoice.billingCycle})`,
    margin,
    y,
    { size: 9, color: muted },
  );
  y -= 26;

  // Line-item table.
  hr(margin, right, y + 6);
  text('DESCRIPTION', margin, y - 6, { size: 9, font: bold, color: muted });
  textRight('AMOUNT', right, y - 6, { size: 9, font: bold, color: muted });
  y -= 12;
  hr(margin, right, y - 2);
  y -= 20;

  const items = invoice.lineItems?.length
    ? invoice.lineItems
    : [{ description: `${invoice.plan} plan (${invoice.billingCycle})`, amountInr: invoice.subtotalInr }];
  for (const it of items) {
    text(it.description, margin, y, { size: 10 });
    textRight(money(it.amountInr), right, y, { size: 10 });
    y -= 16;
  }

  // Totals (right half).
  const totalsX = width / 2;
  y -= 8;
  hr(totalsX, right, y + 8, 0.5);
  const totalRow = (label: string, value: string, o: TextOpts = {}) => {
    text(label, totalsX, y, { size: 9, color: muted, ...o });
    textRight(value, right, y, { size: 9, ...o });
    y -= 15;
  };
  const { cgst, sgst } = gstBreakdown(invoice.taxInr);
  totalRow('Subtotal', money(invoice.subtotalInr));
  totalRow('CGST @ 9%', money(cgst));
  totalRow('SGST @ 9%', money(sgst));
  hr(totalsX, right, y + 9);
  y -= 3;
  totalRow('Total', money(invoice.totalInr), { font: bold, size: 12, color: ink });

  text('This is a computer-generated tax invoice and does not require a signature.', margin, 60, {
    size: 8,
    color: muted,
  });

  return doc.save();
}
