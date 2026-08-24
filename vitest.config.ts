import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The DB-backed route tests need a real Postgres (the app now runs on
// Postgres — provider flipped in VSK-32). Point DATABASE_URL at a THROWAWAY
// Postgres database: CI provides one via a `postgres` service container; local
// runs use the default below (a local Postgres, e.g. `docker run -e
// POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` then
// `createdb vishvakarma_test`). tests/global-setup.ts resets this database on
// every run, so it must never point at a database with real data.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vishvakarma_test";

// global-setup.ts runs in the main process and reads process.env; the test
// workers read `test.env`. Set both so the same URL is used end to end.
process.env.DATABASE_URL = DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // The DB-backed tests share one Postgres database; keep them serial.
    fileParallelism: false,
    env: { DATABASE_URL },
  },
});
