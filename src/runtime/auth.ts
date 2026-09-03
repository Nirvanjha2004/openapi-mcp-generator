export interface AuthHeaders {
  [key: string]: string;
}

/**
 * Resolve authentication headers from environment variables.
 * Supports:
 * - BEARER_TOKEN -> Authorization: Bearer <token>
 * - API_KEY -> x-api-key: <key> (or configured header)
 * - Custom via env var mapping
 */
export function getAuthHeaders(options?: {
  envBearerToken?: string;
  envApiKey?: string;
  apiKeyHeader?: string;
}): AuthHeaders {
  const headers: AuthHeaders = {};

  const bearerEnvVar = options?.envBearerToken ?? "BEARER_TOKEN";
  const apiKeyEnvVar = options?.envApiKey ?? "API_KEY";
  const apiKeyHeader = options?.apiKeyHeader ?? "x-api-key";

  const bearer =
    process.env[bearerEnvVar] ?? process.env["BEARER_TOKEN"] ?? process.env["API_TOKEN"];
  if (bearer) {
    headers["Authorization"] = bearer.startsWith("Bearer ") ? bearer : `Bearer ${bearer}`;
  }

  const apiKey = process.env[apiKeyEnvVar];
  if (apiKey && !headers[apiKeyHeader]) {
    headers[apiKeyHeader] = apiKey;
  }

  // Also support generic API_KEY fallback if custom header
  if (!apiKey && process.env["API_KEY"] && apiKeyHeader !== "x-api-key") {
    headers[apiKeyHeader] = process.env["API_KEY"] as string;
  }

  // Support custom header via env: CUSTOM_HEADER_<NAME>
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MCP_HEADER_") && value) {
      const headerName = key.replace("MCP_HEADER_", "").toLowerCase().replace(/_/g, "-");
      headers[headerName] = value;
    }
  }

  return headers;
}

export function applyAuthHeaders(
  existing: Record<string, string>,
  authHeaders: AuthHeaders
): Record<string, string> {
  return { ...existing, ...authHeaders };
}
