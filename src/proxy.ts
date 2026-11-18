import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

/**
 * Next.js 16 "proxy" (formerly middleware): refreshes the Supabase session and
 * redirects anonymous users to /login. Fine-grained role checks happen in API routes.
 */
const PUBLIC = ["/login", "/api/auth/demo", "/api/auth/login", "/api/auth/config", "/api/exotel"];

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path.startsWith(p));
  // same rule as authMode(): all three Supabase variables, otherwise demo cookie only
  const supabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);

  let res = NextResponse.next();
  let signedIn = Boolean(req.cookies.get("ska_demo")?.value); // signature verified server-side
  if (supabase) ({ res, signedIn } = await updateSession(req));

  if (!signedIn && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: { code: "unauthenticated", message: "Please sign in to continue" } }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo/|images/|icons/).*)"],
};
