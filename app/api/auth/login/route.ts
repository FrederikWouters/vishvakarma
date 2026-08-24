import { NextResponse } from "next/server";
import {
  COOKIE_NAME,
  SESSION_TTL_MS,
  safeReturnPath,
  signSession,
  verifyPassword,
} from "@/lib/auth";

export async function POST(req: Request) {
  const password = process.env.VSK_ACCESS_PASSWORD;
  const form = await req.formData().catch(() => null);
  const submitted =
    typeof form?.get("password") === "string" ? String(form.get("password")) : "";
  const from = safeReturnPath(
    typeof form?.get("from") === "string" ? String(form.get("from")) : null
  );

  // Gate disabled (no password configured): nothing to authenticate against;
  // just send the caller on to where they were going.
  if (!password) {
    return NextResponse.redirect(new URL(from, req.url), { status: 303 });
  }

  const ok = await verifyPassword(submitted, password);
  if (!ok) {
    // Small fixed delay to blunt trivial brute force on a single-user gate.
    await new Promise((r) => setTimeout(r, 250));
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("error", "1");
    if (from !== "/") loginUrl.searchParams.set("from", from);
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const token = await signSession(password);
  const res = NextResponse.redirect(new URL(from, req.url), { status: 303 });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
