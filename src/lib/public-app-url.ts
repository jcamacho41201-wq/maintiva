export const productionPublicAppUrl = "https://app.getmaintiva.com";

type PublicAppUrlEnv = Record<string, string | undefined>;

function normalizeOrigin(value?: string | null) {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.origin;
  } catch {
    return "";
  }
}

function isVercelHost(origin: string) {
  try {
    return new URL(origin).hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export function publicAppBaseUrl({
  requestOrigin,
  env = process.env,
}: {
  requestOrigin?: string | null;
  env?: PublicAppUrlEnv;
} = {}) {
  const productionConfigured = normalizeOrigin(env.APP_URL) || normalizeOrigin(env.NEXT_PUBLIC_APP_URL);

  if (env.VERCEL_ENV === "production") {
    if (productionConfigured && !isVercelHost(productionConfigured)) return productionConfigured;
    return productionPublicAppUrl;
  }

  const previewOrigin = normalizeOrigin(requestOrigin);
  if (previewOrigin) return previewOrigin;

  if (env.VERCEL_ENV === "preview") {
    const vercelUrl = normalizeOrigin(env.VERCEL_URL);
    if (vercelUrl) return vercelUrl;
  }

  return productionConfigured || "http://localhost:3000";
}
