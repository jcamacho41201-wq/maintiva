import { afterEach, describe, expect, it } from "vitest";
import { getDatabaseUrl } from "@/lib/database-url";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
  POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
  POSTGRES_URL: process.env.POSTGRES_URL,
};

function resetDatabaseEnv() {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.POSTGRES_URL_NON_POOLING;
  delete process.env.POSTGRES_URL;
}

describe("database URL resolution", () => {
  afterEach(() => {
    resetDatabaseEnv();
    process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    process.env.POSTGRES_PRISMA_URL = originalEnv.POSTGRES_PRISMA_URL;
    process.env.POSTGRES_URL_NON_POOLING = originalEnv.POSTGRES_URL_NON_POOLING;
    process.env.POSTGRES_URL = originalEnv.POSTGRES_URL;
  });

  it("prefers DATABASE_URL when explicitly configured", () => {
    resetDatabaseEnv();
    process.env.DATABASE_URL = "postgresql://database-url";
    process.env.POSTGRES_PRISMA_URL = "postgresql://postgres-prisma-url";

    expect(getDatabaseUrl()).toBe("postgresql://database-url");
  });

  it("uses the Vercel Supabase Prisma URL when DATABASE_URL is absent", () => {
    resetDatabaseEnv();
    process.env.POSTGRES_PRISMA_URL = "postgresql://postgres-prisma-url";
    process.env.POSTGRES_URL = "postgresql://postgres-url";

    expect(getDatabaseUrl()).toBe("postgresql://postgres-prisma-url");
  });

  it("uses libpq-compatible TLS semantics for Supabase sslmode=require URLs", () => {
    resetDatabaseEnv();
    process.env.POSTGRES_PRISMA_URL = "postgresql://user:pass@db.example.test:5432/postgres?sslmode=require";

    expect(getDatabaseUrl()).toBe(
      "postgresql://user:pass@db.example.test:5432/postgres?sslmode=require&uselibpqcompat=true",
    );
  });

  it("preserves explicit sslrootcert verification settings", () => {
    resetDatabaseEnv();
    process.env.POSTGRES_PRISMA_URL = "postgresql://user:pass@db.example.test:5432/postgres?sslmode=require&sslrootcert=/ca.pem";

    expect(getDatabaseUrl()).toBe(
      "postgresql://user:pass@db.example.test:5432/postgres?sslmode=require&sslrootcert=/ca.pem",
    );
  });
});
