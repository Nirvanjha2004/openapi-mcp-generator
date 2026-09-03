import { getAuthHeaders } from "./auth.js";
import type { McpToolDefinition, ExecutionResult } from "../types.js";
import { ExecutionError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface ExecutorConfig {
  baseUrl: string;
  timeout: number; // ms
  retries: number;
  toolMap: Map<string, McpToolDefinition>;
}

export interface ExecutorOptions {
  fetchImpl?: typeof fetch;
}

export function createExecutor(config: ExecutorConfig, options: ExecutorOptions = {}) {
  const fetchFn: typeof fetch = options.fetchImpl ?? fetch;

  async function execute(toolName: string, args: Record<string, unknown>): Promise<ExecutionResult> {
    const tool = config.toolMap.get(toolName);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool not found: ${toolName}` }],
        isError: true,
      };
    }

    const { method, path } = tool._meta;
    const url = buildUrl(config.baseUrl, path, args, tool.inputSchema, method);
    const { headers, body } = buildHeadersAndBody(args, tool);

    // Apply auth headers from env
    const authHeaders = getAuthHeaders();
    const finalHeaders: Record<string, string> = { ...headers, ...authHeaders };

    logger.debug(`Executing ${toolName}: ${method.toUpperCase()} ${url}`);

    let lastError: unknown;
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);

        const response = await fetchFn(url, {
          method: method.toUpperCase(),
          headers: finalHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const contentType = response.headers.get("content-type") ?? "";
        let responseText: string;
        let isJson = contentType.includes("application/json");

        if (isJson) {
          const json = (await response.json()) as unknown;
          responseText = JSON.stringify(json, null, 2);
        } else {
          responseText = await response.text();
        }

        if (!response.ok) {
          const errorMsg = `HTTP ${response.status} ${response.statusText}\n${responseText}`;
          return {
            content: [{ type: "text", text: errorMsg }],
            isError: true,
          };
        }

        // Structured nicely
        const statusLine = `Status: ${response.status} ${response.statusText}`;
        const formatted = responseText ? `${statusLine}\n\n${responseText}` : statusLine;
        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (err: unknown) {
        lastError = err;
        const isAbort = err instanceof Error && err.name === "AbortError";
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Attempt ${attempt + 1} failed for ${toolName}: ${message}${isAbort ? " (timeout)" : ""}`);
        if (attempt < config.retries) {
          // exponential backoff
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
          continue;
        }
        const errorText = isAbort
          ? `Request timed out after ${config.timeout}ms for ${toolName}`
          : `Execution failed for ${toolName}: ${message}`;
        return {
          content: [{ type: "text", text: errorText }],
          isError: true,
        };
      }
    }

    throw new ExecutionError(`Exhausted retries for ${toolName}`, lastError);
  }

  return { execute };
}

function buildUrl(
  baseUrl: string,
  pathTemplate: string,
  args: Record<string, unknown>,
  schema: McpToolDefinition["inputSchema"],
  method: string
): string {
  let path = pathTemplate;

  // Replace path params: /pets/{id} -> /pets/123
  const pathParams = path.match(/{([^}]+)}/g) ?? [];
  for (const match of pathParams) {
    const key = match.slice(1, -1);
    const value = args[key];
    if (value === undefined || value === null) {
      continue;
    }
    path = path.replace(match, encodeURIComponent(String(value)));
  }

  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  const pathParamNames = pathParams.map((m) => m.slice(1, -1));
  const queryParams = new URLSearchParams();

  for (const [key, value] of Object.entries(args)) {
    if (pathParamNames.includes(key)) continue;
    if (value === undefined || value === null) continue;

    const prop = schema.properties[key];
    const desc: string = (prop?.description as string) ?? "";

    const isHeader = desc.includes("(header)");
    const isPath = desc.includes("(path)");
    const isQuery = desc.includes("(query)");

    if (isHeader || isPath) continue;

    // Only add to query if explicitly marked as query, or if method is GET/DELETE and no marker (assume query)
    // For POST/PUT/PATCH with no marker, treat as body and skip query to avoid duplication
    const isBodyLikeNoMarker = !desc.includes("(") && prop !== undefined;
    if (isBodyLikeNoMarker && ["post", "put", "patch"].includes(method.toLowerCase())) {
      continue;
    }

    // Skip object/array bodies - they'll be handled as JSON body
    if (!isQuery && typeof value === "object" && value !== null) {
      continue;
    }

    // If not query and not GET-like, skip (body case already handled)
    if (!isQuery && isBodyLikeNoMarker) continue;

    // Default: if isQuery true, always add; if no marker but GET, add primitive
    if (isQuery || (!desc.includes("(") && ["get", "delete"].includes(method.toLowerCase()))) {
      if (Array.isArray(value)) {
        for (const v of value) queryParams.append(key, String(v));
      } else {
        queryParams.append(key, String(value));
      }
    } else if (isQuery) {
      if (Array.isArray(value)) {
        for (const v of value) queryParams.append(key, String(v));
      } else {
        queryParams.append(key, String(value));
      }
    } else if (!isQuery && desc.includes("(") === false) {
      // Fallback: no description marker but primitive -> add as query for GET
      if (["get", "delete"].includes(method.toLowerCase())) {
        if (Array.isArray(value)) {
          for (const v of value) queryParams.append(key, String(v));
        } else {
          queryParams.append(key, String(value));
        }
      }
    }
  }

  // Simplified: include isQuery explicitly, and for GET include any non-body primitive
  // The above logic is redundant but ensures correct handling; we clean it to final fallback
  // Re-evaluate: if we haven't added anything yet but there are query-marked props, they are already added.
  // For robustness, also add any query-marked that slipped through
  for (const [key, value] of Object.entries(args)) {
    if (queryParams.has(key)) continue;
    if (pathParamNames.includes(key)) continue;
    if (value === undefined || value === null) continue;
    const prop = schema.properties[key];
    const desc: string = (prop?.description as string) ?? "";
    if (desc.includes("(query)") && !queryParams.has(key)) {
      if (Array.isArray(value)) {
        for (const v of value) queryParams.append(key, String(v));
      } else {
        queryParams.append(key, String(value));
      }
    }
  }

  if (queryParams.toString()) {
    url.search = queryParams.toString();
  }

  return url.toString();
}

function buildHeadersAndBody(
  args: Record<string, unknown>,
  tool: McpToolDefinition
): { headers: Record<string, string>; body: Record<string, unknown> | undefined } {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const body: Record<string, unknown> = {};
  let hasBody = false;

  for (const [key, value] of Object.entries(args)) {
    const prop = tool.inputSchema.properties[key];
    const desc: string = (prop?.description as string) ?? "";

    if (desc.includes("(header)")) {
      headers[key] = String(value);
      continue;
    }
    if (desc.includes("(path)") || desc.includes("(query)")) {
      continue;
    }

    // For body, we collect everything not header/path/query, or with no marker (assumed body)
    // If description indicates header/path/query, skip; otherwise treat as body candidate
    // But our query builder above already added same keys as query - that is intentional fallback
    // Here we include them as body for POST/PUT/PATCH
    if (["post", "put", "patch"].includes(tool._meta.method)) {
      // Only include if not query explicitly
      if (desc.includes("(query)")) continue;
      body[key] = value;
      hasBody = true;
    }
  }

  // Also support raw 'body' field if schema used that wrapper
  if ("body" in args && tool.inputSchema.properties["body"] && !hasBody) {
    const rawBody = args["body"];
    if (typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)) {
      return { headers, body: rawBody as Record<string, unknown> };
    }
    if (rawBody !== undefined) {
      return { headers, body: { value: rawBody } };
    }
  }

  return { headers, body: hasBody ? body : undefined };
}

export function extractPathParamNames(path: string): string[] {
  const matches = path.match(/{([^}]+)}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}
