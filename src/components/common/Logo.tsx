import { cx } from "./ui";

/** The "single key" mark. Matches public/logo/logo.svg. */
export function Logo({ className, tile = "#123833", stroke = "#e6c98a" }: { className?: string; tile?: string; stroke?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cx("h-9 w-9 shrink-0", className)} aria-hidden="true">
      <rect width="64" height="64" rx="15" fill={tile} />
      <g fill="none" stroke={stroke} strokeWidth="5" strokeLinecap="round">
        <circle cx="24" cy="24" r="9.5" />
        <path d="M31 31 49 49M41.5 41.5l5.5-5.5M47 47l3.5-3.5" />
      </g>
    </svg>
  );
}
