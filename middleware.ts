// Root access gate for VSK-18 — the single choke point for the shared-password
// gate. Runs on the Edge runtime, so it must not import Prisma or Node-only
// APIs: it depends solely on `lib/auth` (Web Crypto).
//
// Safety contract (mandatory): when VSK_ACCESS_PASSWORD is unset the gate is
// INERT and default-allows every request. That keeps local dev open and makes
// it impossible to lock yourself out by shipping code without a configured
// password. The gate activates automatically once the hosting environment sets
// VSK_ACCESS_PASSWORD.
//
// Single-secret design: the access password doubles as the HMAC signing key
// (see lib/auth.ts), so the whole gate needs exactly one env var.

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.VSK_ACCESS_PASSWORD;
  // No password configured => gate disabled, never lock out (dev default-allow).
  if (!password) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (await verifySession(password, token)) {
    return NextResponse.next();
  }

  // Unauthenticated. API/JSON callers must get a 401, not an HTML redirect —
  // the client fetches in Board/TicketModal expect JSON.
  const { pathname, search } = req.nextUrl;
  const accept = req.headers.get("accept") ?? "";
  const wantsJson = pathname.startsWith("/api/") || !accept.includes("text/html");
  if (wantsJson) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("from", pathname + search);
  return NextResponse.redirect(loginUrl);
}

// Fail-closed matcher: gate everything EXCEPT framework/static assets and the
// auth surface (the /login page and the login/logout routes) — otherwise the
// login page would redirect to itself. Any new /api/* data route is gated by
// default. Reviewed against the 8 app/api data routes; none is excluded here.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth/login|api/auth/logout).*)",
  ],
};
