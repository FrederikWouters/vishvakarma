import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";

// Provision a throwaway SQLite database for the DB-backed route tests, apply all
// migrations, and delete it when the run finishes. DATABASE_URL is also set for
// the test workers via vitest.config.ts `test.env`.
const TEST_DB = "prisma/test.db";
const url = "file:./test.db";

export default function setup() {
  for (const f of [TEST_DB, `${TEST_DB}-journal`]) {
    if (existsSync(f)) unlinkSync(f);
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  return () => {
    for (const f of [TEST_DB, `${TEST_DB}-journal`]) {
      if (existsSync(f)) unlinkSync(f);
    }
  };
}
