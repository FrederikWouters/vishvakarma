import { execSync } from "node:child_process";

// Reset the Postgres schema for the DB-backed route tests and apply all
// migrations, so every run starts from a known-empty database. Runs against
// DATABASE_URL (a THROWAWAY Postgres — the CI service container or a local
// instance; see vitest.config.ts), never a production database.
//
// The schema is dropped and recreated (destructive by design), then the
// migrations are replayed with `prisma migrate deploy`. The guard below refuses
// anything that is not a Postgres URL so a stray `file:`/production value can
// never be reset here. We reset with an explicit DROP SCHEMA rather than
// `prisma migrate reset` because the latter prompts / is blocked in
// non-interactive runs.
export default function setup() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      "Tests require a Postgres DATABASE_URL (throwaway DB). " +
        `Got: ${url ?? "<unset>"}. See vitest.config.ts.`
    );
  }
  const env = { ...process.env, DATABASE_URL: url };
  execSync(`npx prisma db execute --url "${url}" --stdin`, {
    input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
    stdio: ["pipe", "inherit", "inherit"],
    env,
  });
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
}
