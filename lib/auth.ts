// Edge-safe session helpers for the shared-password access gate (VSK-18).
//
// This module MUST stay free of Prisma / Node-only APIs: it is imported by the
// root middleware, which runs on the Edge runtime where `@prisma/client`,
// Node's `crypto` and `Buffer` are not available. Everything here uses Web
// Crypto (`crypto.subtle`), `TextEncoder`, and `btoa`/`atob` only.
//
// Design: the cookie is `<payload>.<sig>` where `payload` is base64url JSON
// `{ v, iat, exp }` (no secret in it — it only proves "someone knew the password
// at sign time") and `sig` is base64url HMAC-SHA256 of the payload string keyed
// by the shared password. The password doubles as the signing key so the gate
// needs exactly ONE secret (VSK_ACCESS_PASSWORD); rotating the password
// invalidates existing sessions, which is acceptable for a single user.

export const COOKIE_NAME = "vsk_session";

// 30 days, mirrored into the cookie Max-Age by the login route.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  v: number;
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// TextEncoder always yields an ArrayBuffer-backed view (never SharedArrayBuffer),
// so the cast is safe and lets the result satisfy `BufferSource` under TS 5.7's
// stricter typed-array generics without copying.
function encodeText(value: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(value) as Uint8Array<ArrayBuffer>;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encodeText(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encodeText(data));
  return new Uint8Array(sig);
}

// Produce a signed session token valid for `ttlMs` from now.
export async function signSession(
  secret: string,
  ttlMs: number = SESSION_TTL_MS,
  now: number = Date.now()
): Promise<string> {
  const payload: SessionPayload = { v: 1, iat: now, exp: now + ttlMs };
  const payloadB64 = toBase64url(encodeText(JSON.stringify(payload)));
  const sigB64 = toBase64url(await hmac(secret, payloadB64));
  return `${payloadB64}.${sigB64}`;
}

// True only when the signature matches (constant-time via crypto.subtle.verify)
// AND the payload has not expired. A flipped byte in either half fails.
export async function verifySession(
  secret: string,
  token: string | undefined | null,
  now: number = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = fromBase64url(sigB64);
  } catch {
    return false;
  }

  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encodeText(payloadB64)
  );
  if (!ok) return false;

  try {
    const json = new TextDecoder().decode(fromBase64url(payloadB64));
    const payload = JSON.parse(json) as SessionPayload;
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

// Sanitise a post-login `from` destination so it can only ever be a same-origin
// relative path — never an open redirect. Returns "/" for anything unsafe.
//
// A naive `startsWith("//")` guard is NOT enough: the WHATWG URL parser Next
// uses treats a backslash as "/" and strips leading ASCII whitespace/control
// chars, so `/\evil.example/x` resolves to `http://evil.example/x` and
// `/\t/evil` to `http://evil/`. We therefore reject anything but a single
// leading slash, any backslash or ASCII control char (0x00-0x1F, 0x7F), and —
// belt and braces — anything that doesn't resolve back to the base origin.
export function safeReturnPath(from: string | null | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return "/";
  // Backslashes and control chars are the vectors the URL parser normalises
  // off-origin; kill them before they reach `new URL`.
  // eslint-disable-next-line no-control-regex
  if (/[\\\x00-\x1f\x7f]/.test(from)) return "/";
  try {
    const base = "http://localhost";
    if (new URL(from, base).origin !== base) return "/";
  } catch {
    return "/";
  }
  return from;
}

// Constant-time password comparison (the Edge-safe equivalent of timingSafeEqual):
// HMAC both strings with the same key and let crypto.subtle.verify compare the
// MACs. Never log either value.
export async function verifyPassword(
  input: string,
  expected: string
): Promise<boolean> {
  if (!expected) return false;
  const key = await importKey(expected);
  const expectedSig = await crypto.subtle.sign("HMAC", key, encodeText(expected));
  return crypto.subtle.verify("HMAC", key, expectedSig, encodeText(input));
}
