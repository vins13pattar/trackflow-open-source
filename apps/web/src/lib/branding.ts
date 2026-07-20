import { hexToHsl } from './utils';

/** Applies (or clears) the tenant's primary color as the live theme accent. */
export function applyBrandColor(hex: string | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--ring');
    return;
  }
  const hsl = hexToHsl(hex);
  if (hsl) {
    root.style.setProperty('--primary', hsl);
    root.style.setProperty('--ring', hsl);
  }
}
