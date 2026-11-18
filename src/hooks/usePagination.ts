"use client";
import { useState } from "react";

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface PaginationState<T = unknown> {
  page: number; pageCount: number; pageSize: number; total: number;
  /** 1-based index of the first / last row on this page (0 when empty). */
  from: number; to: number;
  rows: T[];
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/**
 * Client-side pagination for a loaded list.
 * - `resetKey`: pass the current filter/search (e.g. the query string). When it changes the
 *   list goes back to page 1.
 * - The page is clamped when the data shrinks (live polling, deletes), so a list never shows
 *   an empty page beyond the end.
 */
export function usePagination<T>(rows: T[] | null | undefined, opts: { pageSize?: number; resetKey?: unknown } = {}): PaginationState<T> {
  const [pageSize, setSize] = useState<number>(opts.pageSize ?? 25);
  const [page, setRawPage] = useState(1);
  const [lastKey, setLastKey] = useState(opts.resetKey);
  if (!Object.is(lastKey, opts.resetKey)) {
    // adjusting state while rendering on a prop change (React-recommended pattern; no effect flash)
    setLastKey(opts.resetKey);
    setRawPage(1);
  }
  const list = rows ?? [];
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    page: current, pageCount, pageSize, total,
    from: total ? start + 1 : 0, to: Math.min(start + pageSize, total),
    rows: list.slice(start, start + pageSize),
    setPage: (p) => setRawPage(Math.max(1, Math.min(Math.trunc(p) || 1, pageCount))),
    setPageSize: (s) => { setSize(s); setRawPage(1); },
  };
}

/** Page buttons to show: first, last, current ±1, with gaps ("…") between. */
export function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const want = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount));
  const sorted = [...want].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push(n - sorted[i - 1] === 2 ? n - 1 : "gap");
    out.push(n);
  });
  return out;
}
