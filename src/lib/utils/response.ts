import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError } from "../data/types";
import { rateLimit } from "./rate-limit";

export const ok = <T>(data: T, status = 200) => NextResponse.json({ ok: true, data }, { status });

export function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

export function toErrorResponse(e: unknown) {
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
    return fail(422, "validation_error", "Please correct the highlighted fields", fields);
  }
  if (e instanceof AppError) return fail(e.status, e.code, e.message, e.details);
  if (e instanceof SyntaxError) return fail(400, "bad_json", "Request body is not valid JSON");
  console.error("[api] unhandled error", e);
  return fail(500, "internal_error", "Something went wrong. Please try again.");
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler with rate limiting + uniform error handling. */
export function api<C = unknown>(fn: Handler<C>, opts: { limit?: number } = {}): Handler<C> {
  return async (req, ctx) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!rateLimit(`${ip}:${req.nextUrl.pathname}:${req.method}`, opts.limit ?? 120)) {
      return fail(429, "rate_limited", "Too many requests. Please slow down.");
    }
    try {
      return await fn(req, ctx);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 100_000) throw new AppError(413, "too_large", "Request body too large");
  return text ? JSON.parse(text) : {};
}
