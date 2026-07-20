import { and, eq, notificationTemplates, tenants, withSystem } from '@trackflow/db';
import { db } from './db.js';
import { DEFAULT_LOCALE, DEFAULT_TEMPLATES, type TemplateContent } from './template-defaults.js';

export type Vars = Record<string, string | number | undefined>;

export interface RenderedContent {
  subject: string;
  body: string;
}

/** Substitutes `{{var}}` (with optional whitespace) using `vars`. Missing
 *  variables render as empty strings — never throws. Plain text substitution,
 *  no HTML escaping (callers that emit HTML must escape themselves). */
export function render(template: string, vars: Vars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

/** Resolves the template for a tenant + event + locale, falling back through:
 *  1. tenant template for (event, locale)
 *  2. tenant template for (event, 'en')
 *  3. built-in default for (event, locale)
 *  4. built-in default for (event, 'en')
 *  Returns null when no built-in covers the event at all. */
export async function resolveTemplate(tenantId: string, eventType: string, locale = DEFAULT_LOCALE): Promise<TemplateContent | null> {
  // notification_templates is RLS-scoped by tenant; the where-clause does the
  // scoping here, so withSystem (RLS bypass) is the consistent system-read path.
  const rows = await withSystem(db, (tx) =>
    tx
      .select({ locale: notificationTemplates.locale, subject: notificationTemplates.subject, body: notificationTemplates.body })
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.tenantId, tenantId),
          eq(notificationTemplates.eventType, eventType),
          eq(notificationTemplates.active, true),
        ),
      ),
  );
  const byLocale = new Map(rows.map((r) => [r.locale, r]));
  const custom = byLocale.get(locale) ?? byLocale.get(DEFAULT_LOCALE);
  if (custom) return { subject: custom.subject, body: custom.body };

  const defaults = DEFAULT_TEMPLATES[eventType];
  if (!defaults) return null;
  return defaults[locale] ?? defaults[DEFAULT_LOCALE] ?? null;
}

/** Convenience: resolves the template for the tenant's preferred locale and
 *  renders it with `vars`. Returns null when there's no template for the event. */
export async function getNotificationContent(tenantId: string, eventType: string, vars: Vars, locale?: string): Promise<RenderedContent | null> {
  const effectiveLocale = locale ?? (await tenantLocale(tenantId));
  const tmpl = await resolveTemplate(tenantId, eventType, effectiveLocale);
  if (!tmpl) return null;
  return { subject: render(tmpl.subject, vars), body: render(tmpl.body, vars) };
}

async function tenantLocale(tenantId: string): Promise<string> {
  const [t] = await db.select({ locale: tenants.locale }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.locale ?? DEFAULT_LOCALE;
}
