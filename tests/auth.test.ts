import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  COOKIE_NAME,
  safeReturnPath,
  signSession,
  verifySession,
  verifyPassword,
} from "@/lib/auth";
import { middleware, config } from "@/middleware";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";

const PASSWORD = "correct horse battery staple";

// --- lib/auth: sign / verify -------------------------------------------------

describe("lib/auth signSession / verifySession", () => {
  it("round-trips: a freshly signed token verifies", async () => {
    const token = await signSession(PASSWORD);
    expect(await verifySession(PASSWORD, token)).toBe(true);
  });

  it("rejects an empty/undefined token", async () => {
    expect(await verifySession(PASSWORD, undefined)).toBe(false);
    expect(await verifySession(PASSWORD, "")).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(PASSWORD);
    expect(await verifySession("a different password", token)).toBe(false);
  });

  it("rejects a token with a flipped signature byte", async () => {
    const token = await signSession(PASSWORD);
    const [payload, sig] = token.split(".");
    const flipped = payload + "." + (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(await verifySession(PASSWORD, flipped)).toBe(false);
  });

  it("rejects a token with a tampered payload", async () => {
    const token = await signSession(PASSWORD);
    const [payload, sig] = token.split(".");
    const tampered = (payload[0] === "A" ? "B" : "A") + payload.slice(1) + "." + sig;
    expect(await verifySession(PASSWORD, tampered)).toBe(false);
  });

  it("rejects a structurally-broken token (no dot)", async () => {
    expect(await verifySession(PASSWORD, "notoken")).toBe(false);
  });

  it("rejects an expired token", async () => {
    const past = Date.now() - 1000;
    // TTL of 1ms signed 'now', then checked well after expiry.
    const token = await signSession(PASSWORD, 1, past);
    expect(await verifySession(PASSWORD, token, Date.now())).toBe(false);
  });
});

// --- lib/auth: password compare ---------------------------------------------

describe("lib/auth verifyPassword", () => {
  it("accepts the exact password", async () => {
    expect(await verifyPassword(PASSWORD, PASSWORD)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    expect(await verifyPassword("nope", PASSWORD)).toBe(false);
  });
  it("rejects an empty submitted password", async () => {
    expect(await verifyPassword("", PASSWORD)).toBe(false);
  });
  it("rejects when the expected password is empty", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});

// --- lib/auth: safeReturnPath (open-redirect guard) --------------------------

describe("lib/auth safeReturnPath", () => {
  it("allows a normal same-origin relative path", () => {
    expect(safeReturnPath("/projects/x/board/analysis")).toBe(
      "/projects/x/board/analysis"
    );
  });

  it("allows a relative path with query and hash", () => {
    expect(safeReturnPath("/settings?tab=1#top")).toBe("/settings?tab=1#top");
  });

  it("falls back to / for empty, null or undefined", () => {
    expect(safeReturnPath("")).toBe("/");
    expect(safeReturnPath(null)).toBe("/");
    expect(safeReturnPath(undefined)).toBe("/");
  });

  it("rejects a protocol-relative //host path", () => {
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("//evil.example/x")).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeReturnPath("http://evil.example/x")).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
  });

  it("rejects a backslash vector the URL parser resolves off-origin", () => {
    // new URL("/\\evil.example/x", origin) === http://evil.example/x
    expect(safeReturnPath("/\\evil.example/x")).toBe("/");
    expect(safeReturnPath("/\\/evil.example")).toBe("/");
    expect(safeReturnPath("\\\\evil.example")).toBe("/");
  });

  it("rejects control-character vectors (tab/newline/CR/NUL) the parser strips", () => {
    // new URL("/\t/evil", origin) === http://evil/
    expect(safeReturnPath("/\t/evil")).toBe("/");
    expect(safeReturnPath("/\n/evil")).toBe("/");
    expect(safeReturnPath("/\r/evil")).toBe("/");
    expect(safeReturnPath("/\x00/evil")).toBe("/");
    expect(safeReturnPath("/\x7f/evil")).toBe("/");
  });

  it("rejects a path not starting with a slash", () => {
    expect(safeReturnPath("evil.example")).toBe("/");
  });
});

// --- middleware gate ---------------------------------------------------------

function req(path: string, opts: { cookie?: string; accept?: string } = {}) {
  const headers = new Headers();
  if (opts.accept) headers.set("accept", opts.accept);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return new NextRequest(`http://test${path}`, { headers });
}

describe("middleware gate", () => {
  const prev = process.env.VSK_ACCESS_PASSWORD;
  afterEach(() => {
    if (prev === undefined) delete process.env.VSK_ACCESS_PASSWORD;
    else process.env.VSK_ACCESS_PASSWORD = prev;
  });

  it("default-allows every request when the password env var is unset", async () => {
    delete process.env.VSK_ACCESS_PASSWORD;
    const res = await middleware(req("/api/tickets", { accept: "application/json" }));
    // NextResponse.next() carries the x-middleware-next marker and no redirect.
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.status).toBe(200);
  });

  it("returns 401 JSON for an unauthenticated /api/* request", async () => {
    process.env.VSK_ACCESS_PASSWORD = PASSWORD;
    const res = await middleware(req("/api/tickets", { accept: "application/json" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("redirects an unauthenticated HTML page request to /login?from=...", async () => {
    process.env.VSK_ACCESS_PASSWORD = PASSWORD;
    const res = await middleware(req("/settings", { accept: "text/html" }));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("from")).toBe("/settings");
  });

  it("treats a non-HTML page request (e.g. a bare fetch) as JSON => 401", async () => {
    process.env.VSK_ACCESS_PASSWORD = PASSWORD;
    const res = await middleware(req("/settings"));
    expect(res.status).toBe(401);
  });

  it("allows through when a valid session cookie is present", async () => {
    process.env.VSK_ACCESS_PASSWORD = PASSWORD;
    const token = await signSession(PASSWORD);
    const res = await middleware(
      req("/api/tickets", { accept: "application/json", cookie: `${COOKIE_NAME}=${token}` })
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects a tampered session cookie", async () => {
    process.env.VSK_ACCESS_PASSWORD = PASSWORD;
    const token = await signSession(PASSWORD);
    // Tamper a SIGNIFICANT signature byte, not the trailing base64 char. HMAC-
    // SHA256 is 32 bytes, so the signature's final base64url char only carries
    // padding bits that atob discards — flipping it can decode to the identical
    // bytes and verify true (~6% flake). sig[0] carries real signature bits, so
    // verification fails deterministically.
    const [payload, sig] = token.split(".");
    const bad = payload + "." + (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const res = await middleware(
      req("/api/tickets", { accept: "application/json", cookie: `${COOKIE_NAME}=${bad}` })
    );
    expect(res.status).toBe(401);
  });
});

// --- matcher: the auth surface is excluded (fail-closed elsewhere) -----------

describe("middleware matcher", () => {
  // Reconstruct the runtime regex Next builds from the negative-lookahead
  // matcher so we can assert exactly which paths are gated.
  const re = new RegExp("^" + config.matcher[0] + "$");

  it("excludes the login page and the auth routes", () => {
    expect(re.test("/login")).toBe(false);
    expect(re.test("/api/auth/login")).toBe(false);
    expect(re.test("/api/auth/logout")).toBe(false);
  });

  it("excludes framework/static assets", () => {
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/favicon.ico")).toBe(false);
  });

  it("gates all data API routes and pages", () => {
    for (const p of [
      "/",
      "/settings",
      "/projects/abc/board/analysis",
      "/api/tickets",
      "/api/tickets/123",
      "/api/columns",
      "/api/labels",
      "/api/projects",
    ]) {
      expect(re.test(p)).toBe(true);
    }
  });
});

// --- login / logout routes ---------------------------------------------------

function loginPost(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request("http://test/api/auth/login", { method: "POST", body });
}

describe("POST /api/auth/login", () => {
  const prev = process.env.VSK_ACCESS_PASSWORD;
  beforeEach(() => {
    process.env.VSK_ACCESS_PASSWORD = PASSWORD;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.VSK_ACCESS_PASSWORD;
    else process.env.VSK_ACCESS_PASSWORD = prev;
  });

  it("sets an HttpOnly, SameSite=Lax session cookie on the right password", async () => {
    const res = await login(loginPost({ password: PASSWORD, from: "/settings" }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/settings");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${COOKIE_NAME}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    // The cookie value must be a verifiable session token.
    const value = cookie.split(";")[0].split("=").slice(1).join("=");
    expect(await verifySession(PASSWORD, decodeURIComponent(value))).toBe(true);
  });

  it("sets no cookie and flags an error on the wrong password", async () => {
    const res = await login(loginPost({ password: "wrong", from: "/settings" }));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("1");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("ignores an off-site `from` (open-redirect guard) and lands on /", async () => {
    const res = await login(loginPost({ password: PASSWORD, from: "//evil.example/x" }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("ignores backslash/control-char `from` vectors and stays same-origin", async () => {
    for (const evil of ["/\\evil.example/x", "/\t/evil", "\\\\evil.example"]) {
      const res = await login(loginPost({ password: PASSWORD, from: evil }));
      const loc = new URL(res.headers.get("location")!);
      // Never leaves the request origin (http://test).
      expect(loc.origin).toBe("http://test");
      expect(loc.pathname).toBe("/");
    }
  });

  it("honours a legitimate same-origin `from`", async () => {
    const res = await login(
      loginPost({ password: PASSWORD, from: "/projects/x/board/analysis" })
    );
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("http://test");
    expect(loc.pathname).toBe("/projects/x/board/analysis");
  });

  it("marks the cookie Secure when NODE_ENV=production", async () => {
    const prevEnv = process.env.NODE_ENV;
    // NODE_ENV is read-only-typed; assign through a cast.
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const res = await login(loginPost({ password: PASSWORD }));
      expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("secure");
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prevEnv ?? "test";
    }
  });
});

describe("POST /api/auth/logout", () => {
  it("emits a clearing Set-Cookie and redirects to /login", async () => {
    const res = await logout(new Request("http://test/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${COOKIE_NAME}=`);
    expect(cookie.toLowerCase()).toMatch(/max-age=0|expires=/);
  });
});
