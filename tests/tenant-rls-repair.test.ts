import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261105120000_restore_tenant_rls_and_grants.sql", "utf8");

describe("review-only tenant security repair", () => {
  it("does not mutate records, recreate tables, or disable RLS", () => {
    expect(sql).not.toMatch(/\b(?:DELETE FROM|UPDATE public\.|INSERT INTO|DROP TABLE|TRUNCATE TABLE|DISABLE ROW LEVEL|WITH CHECK\s*\(true\)|USING\s*\(true\))/i);
    expect(sql).toContain("BEGIN;");
    expect(sql.trim()).toMatch(/COMMIT;$/);
  });

  it("removes broad browser grants and preserves backend DML", () => {
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("TO service_role");
    expect(sql).not.toMatch(/GRANT (?:ALL|TRUNCATE|REFERENCES|TRIGGER)/);
    expect(sql).toContain('ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY');
  });

  it("keeps control-plane writes backend-only and guards membership recursion", () => {
    expect(sql).toContain("ARRAY['User', 'Shop', 'ShopMembership', 'AuditLog']");
    expect(sql).toContain("THEN ARRAY['SELECT']");
    expect(sql).toContain("p.prosecdef AND r.rolbypassrls");
    expect(sql).toContain('public.maintiva_is_shop_member("shopId")');
    expect(sql).toContain("Unexpected existing policies");
  });
});
