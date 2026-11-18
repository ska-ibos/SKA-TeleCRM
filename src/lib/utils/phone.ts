/**
 * Normalise Indian / international numbers to E.164.
 * 9876543210, 09876543210, 919876543210, +91 98765-43210 -> +919876543210
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  const plus = raw.startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (plus) return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d[2])) return `+${d}`;
  if (/^0\d{10}$/.test(raw.replace(/\D/g, ""))) return `+91${d}`; // landline with STD code
  if (d.length >= 11 && d.length <= 15 && !d.startsWith("0")) return `+${d}`;
  return null;
}

export const isValidPhone = (s: string) => normalizePhone(s) !== null;

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** Mask for low-privilege display, e.g. +91 98••• ••210 */
export const maskPhone = (e164: string) => e164.replace(/^(\+\d{4})\d+(\d{3})$/, "$1•••••$2");
