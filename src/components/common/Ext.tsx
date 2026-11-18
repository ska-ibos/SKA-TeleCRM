import { cx } from "./ui";

/** A team member's direct-dial extension, e.g. "ext 13". Renders nothing when there is none. */
export function Ext({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <span title={`Direct extension ${value}: callers can enter it at the greeting`}
      className={cx("ml-1.5 inline-flex items-center rounded-md bg-brand-50 px-1.5 py-px align-middle font-mono text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-100", className)}>
      ext {value}
    </span>
  );
}
