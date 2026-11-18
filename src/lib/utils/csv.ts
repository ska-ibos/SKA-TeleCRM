/** RFC 4180 CSV with formula-injection protection. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    // formula-injection guard; plain numbers like +919876543210 or -5 are left intact
    if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]\d+(\.\d+)?$/.test(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}
