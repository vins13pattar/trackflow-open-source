import { billingRates, eq } from '@trackflow/db';
import { db } from './db.js';

/** A metered resource's operator cost, markup, and resulting client rate. */
export interface BilledRate {
  resource: string;
  unitCostInr: number;
  markup: number;
  ratePerUnitInr: number; // unitCostInr × markup
}

let cache: Map<string, BilledRate> | null = null;

async function load(): Promise<Map<string, BilledRate>> {
  const rows = await db.select().from(billingRates).where(eq(billingRates.active, true));
  const m = new Map<string, BilledRate>();
  for (const r of rows) {
    m.set(r.resource, { resource: r.resource, unitCostInr: r.unitCostInr, markup: r.markup, ratePerUnitInr: r.unitCostInr * r.markup });
  }
  return m;
}

async function ensure(): Promise<Map<string, BilledRate>> {
  if (!cache) cache = await load();
  return cache;
}

/** Drop the cache so the next read reloads (call after admin edits). */
export function invalidateRatesCache(): void {
  cache = null;
}

export async function getBilledRate(resource: string): Promise<BilledRate | null> {
  return (await ensure()).get(resource) ?? null;
}

export async function listRates(): Promise<BilledRate[]> {
  return [...(await ensure()).values()];
}
