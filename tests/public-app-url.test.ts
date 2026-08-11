import { describe, expect, it } from "vitest";
import { appointmentRequestUrl } from "@/lib/appointment-request-tokens";
import { publicAppBaseUrl, productionPublicAppUrl } from "@/lib/public-app-url";

describe("public app URL strategy", () => {
  it("uses the canonical Maintiva domain for production customer request links", () => {
    const baseUrl = publicAppBaseUrl({
      requestOrigin: "https://maintiva-git-codex-preview.vercel.app",
      env: {
        VERCEL_ENV: "production",
        APP_URL: "https://maintiva-xi.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://maintiva-xi.vercel.app",
      },
    });
    const url = appointmentRequestUrl(baseUrl, "a".repeat(43));

    expect(baseUrl).toBe(productionPublicAppUrl);
    expect(url).toBe(`https://app.getmaintiva.com/request/${"a".repeat(43)}`);
    expect(url).not.toContain("vercel.app");
  });

  it("honors an explicitly configured non-Vercel production app origin", () => {
    expect(publicAppBaseUrl({
      requestOrigin: "https://maintiva-xi.vercel.app",
      env: { VERCEL_ENV: "production", APP_URL: "https://app.getmaintiva.com/" },
    })).toBe("https://app.getmaintiva.com");
  });

  it("uses the preview request origin for isolated QA links", () => {
    expect(publicAppBaseUrl({
      requestOrigin: "https://maintiva-git-codex-feature-user.vercel.app",
      env: { VERCEL_ENV: "preview", APP_URL: "https://app.getmaintiva.com" },
    })).toBe("https://maintiva-git-codex-feature-user.vercel.app");
  });

  it("uses localhost in local development", () => {
    expect(publicAppBaseUrl({
      requestOrigin: "http://localhost:3000",
      env: { APP_URL: "http://localhost:3000" },
    })).toBe("http://localhost:3000");
  });
});
