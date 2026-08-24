// Public login page for the shared-password gate (VSK-18). Excluded from the
// middleware matcher so it is always reachable. A plain HTML form POSTs to
// /api/auth/login, which sets the session cookie and 303-redirects back to
// `from` (or /). No client JS required.

import { safeReturnPath } from "@/lib/auth";

export const metadata = { title: "Sign in — Vishvakarma" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;

  return (
    <div style={{ maxWidth: 360, margin: "4rem auto" }}>
      <form
        method="post"
        action="/api/auth/login"
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <h1 className="page-title">Sign in</h1>
        {error ? (
          <p className="subtle" role="alert" style={{ color: "#c0392b" }}>
            Incorrect password.
          </p>
        ) : null}
        <input type="hidden" name="from" value={safeReturnPath(from)} />
        <label htmlFor="password" className="subtle">
          Password
        </label>
        <input
          id="password"
          className="modal-input"
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button className="btn btn-primary" type="submit">
          Sign in
        </button>
      </form>
    </div>
  );
}
