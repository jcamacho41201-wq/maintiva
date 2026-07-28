import { afterEach, describe, expect, it, vi } from "vitest";
import { mutatePilotState, shouldUseLocalDemoPersistence } from "@/lib/demo-store";

const originalEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET: process.env.NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET,
};

describe("demo persistence mode", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET = originalEnv.NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET;
    vi.unstubAllGlobals();
  });

  it("uses production persistence when Supabase is configured, even if demo reset is visible", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET = "true";

    expect(shouldUseLocalDemoPersistence()).toBe(false);
  });

  it("falls back to local demo persistence only when Supabase Auth is not configured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    expect(shouldUseLocalDemoPersistence()).toBe(true);
  });

  it("does not report a failed database mutation as successful", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ code: "MUTATION_FAILED", message: "Unable to save changes." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));

    await expect(mutatePilotState({ action: "importCsvRows", payload: {} })).resolves.toEqual({
      ok: false,
      message: "Unable to save changes.",
    });
  });
});
