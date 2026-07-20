/**
 * Built-in notification templates per event type × locale. Used when a tenant
 * hasn't customised one. Variables are `{{name}}` placeholders substituted at
 * render time. Tenants can override any of these per (event, locale).
 */
export interface TemplateContent {
  subject: string;
  body: string;
}

export const DEFAULT_LOCALE = 'en';

export const DEFAULT_TEMPLATES: Record<string, Record<string, TemplateContent>> = {
  'geofence.enter': {
    en: { subject: 'Device entered {{geofenceName}}', body: '{{deviceName}} entered {{geofenceName}} at {{time}}.' },
    hi: { subject: '{{deviceName}} ने {{geofenceName}} में प्रवेश किया', body: '{{deviceName}} ने {{time}} पर {{geofenceName}} में प्रवेश किया।' },
  },
  'geofence.exit': {
    en: { subject: 'Device left {{geofenceName}}', body: '{{deviceName}} left {{geofenceName}} at {{time}}.' },
    hi: { subject: '{{deviceName}} ने {{geofenceName}} छोड़ा', body: '{{deviceName}} ने {{time}} पर {{geofenceName}} छोड़ा।' },
  },
  'device.offline': {
    en: { subject: '{{deviceName}} went offline', body: '{{deviceName}} has not reported since {{lastSeen}}.' },
    hi: { subject: '{{deviceName}} ऑफ़लाइन हो गया', body: '{{deviceName}} ने {{lastSeen}} से रिपोर्ट नहीं की है।' },
  },
  'ingest.downtime': {
    en: { subject: 'Ingest appears down', body: 'No position ingest for {{ageSeconds}}s ({{activeDevices}} active device(s) expected to report).' },
    hi: { subject: 'इनगेस्ट डाउन प्रतीत होता है', body: 'पिछले {{ageSeconds}} सेकंड से कोई position ingest नहीं ({{activeDevices}} सक्रिय डिवाइस)।' },
  },
};

/** True if the engine has a built-in default for this event (in any locale). */
export const hasDefaultFor = (eventType: string): boolean => eventType in DEFAULT_TEMPLATES;
