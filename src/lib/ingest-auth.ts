function configuredIngestSecrets(): string[] {
  return [process.env.INGEST_API_KEY, process.env.HIGHTOUCH_API_KEY]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

export function verifyIngestAuth(headers: Headers): boolean {
  const validSecrets = configuredIngestSecrets();
  if (validSecrets.length === 0) return false;

  const authHeader = headers.get("authorization")?.trim();
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  const hightouchToken = headers.get("x-hightouch-token")?.trim() ?? null;

  return [bearerToken, hightouchToken].some(
    (token) => token !== null && validSecrets.includes(token),
  );
}
