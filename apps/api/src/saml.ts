/**
 * SAML 2.0 SP for enterprise SSO. Per-tenant config lives in `saml_configs`
 * (one row per tenant). Tenants are resolved at the URL slug — e.g.
 * /auth/saml/<slug>/login. On a valid SAMLResponse we map the assertion's
 * email to a TrackFlow user; if no user exists for that email in the tenant,
 * we just-in-time provision one with the tenant's configured default role
 * (so onboarding doesn't require manual user creation alongside the IdP).
 *
 * Library: @node-saml/node-saml — pure TS, no XML toolchain to wrangle.
 */
import { SAML } from '@node-saml/node-saml';
import type { SamlConfig } from '@trackflow/db';

export type SamlConfigRow = SamlConfig;

/** Wraps a stored saml_configs row in a node-saml client. The `passive` and
 *  `signatureAlgorithm` defaults match modern IdP expectations (SHA-256). */
export function buildSamlClient(cfg: SamlConfigRow): SAML {
  return new SAML({
    callbackUrl: cfg.acsUrl,
    issuer: cfg.audience,
    entryPoint: cfg.ssoUrl,
    idpIssuer: cfg.entityId,
    idpCert: cfg.certificate,
    audience: cfg.audience,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    // We don't decrypt — IdPs that encrypt the assertion will need additional
    // config (privateKey + decryptionPvk) added later.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
  });
}

/** Extracts the email + display name from a SAML assertion's attribute set
 *  using the tenant-configured attribute keys. Falls back to the NameID. */
export function extractProfile(
  cfg: SamlConfigRow,
  attrs: Record<string, unknown> | undefined,
  nameId: string | undefined,
): { email: string; name: string } | null {
  const a = attrs ?? {};
  const emailRaw = a[cfg.attributeEmail] ?? a['email'] ?? a['emailAddress'] ?? nameId;
  const nameRaw = a[cfg.attributeName] ?? a['displayName'] ?? a['name'] ?? a['givenName'] ?? '';
  const email = Array.isArray(emailRaw) ? String(emailRaw[0] ?? '') : String(emailRaw ?? '');
  const name = Array.isArray(nameRaw) ? String(nameRaw[0] ?? '') : String(nameRaw ?? '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { email: email.toLowerCase(), name: name || email.split('@')[0]! };
}
