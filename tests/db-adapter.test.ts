import assert from "node:assert/strict";
import test from "node:test";
import { PERSISTENT_DATABASE_REQUIRED_MESSAGE, resolveDatabaseDialect } from "../src/lib/db/adapter";

test("Vercel production without DATABASE_URL or POSTGRES_URL fails safe", () => {
  assert.throws(
    () => resolveDatabaseDialect({
      VERCEL: "1",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    }),
    new RegExp(PERSISTENT_DATABASE_REQUIRED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("local development without DATABASE_URL or POSTGRES_URL keeps SQLite fallback", () => {
  assert.equal(resolveDatabaseDialect({ NODE_ENV: "development" }), "sqlite");
});

test("Vercel production with DATABASE_URL selects Postgres", () => {
  assert.equal(
    resolveDatabaseDialect({
      VERCEL: "1",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:password@example.test:5432/llmlab",
    }),
    "postgres",
  );
});

test("hosted previews require a database unless ephemeral SQLite is explicitly allowed", () => {
  assert.throws(
    () => resolveDatabaseDialect({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    }),
    new RegExp(PERSISTENT_DATABASE_REQUIRED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );

  assert.equal(
    resolveDatabaseDialect({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      ALLOW_EPHEMERAL_SQLITE: "true",
    }),
    "sqlite",
  );
});
