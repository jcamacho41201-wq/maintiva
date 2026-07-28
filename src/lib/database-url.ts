function withPgSslCompatibility(connectionString: string) {
  if (!connectionString) return connectionString;

  try {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return connectionString;

    const sslMode = url.searchParams.get("sslmode");
    if (
      (sslMode === "require" || sslMode === "prefer") &&
      !url.searchParams.has("sslrootcert") &&
      !url.searchParams.has("uselibpqcompat")
    ) {
      url.searchParams.set("uselibpqcompat", "true");
      return url.toString();
    }
  } catch {
    return connectionString;
  }

  return connectionString;
}

export function getDatabaseUrl() {
  const connectionString = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    ""
  );

  return withPgSslCompatibility(connectionString);
}
