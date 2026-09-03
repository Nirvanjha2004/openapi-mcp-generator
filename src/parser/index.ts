import SwaggerParser from "@apidevtools/swagger-parser";
import { SpecParseError } from "../utils/errors.js";
import { assertValidInput, isHttpUrl } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

export interface ParsedOpenApiSpec {
  raw: Record<string, unknown>;
  dereferenced: OpenApiDocument;
  baseUrl: string;
  title: string;
  version: string;
}

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: Record<string, unknown>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: "query" | "path" | "header" | "cookie";
    required?: boolean;
    description?: string;
    schema?: Record<string, unknown>;
  }>;
  requestBody?: {
    description?: string;
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, unknown>;
  tags?: string[];
  deprecated?: boolean;
}

/**
 * Parse and dereference an OpenAPI spec from a local file or remote URL.
 */
export async function parseSpec(input: string): Promise<ParsedOpenApiSpec> {
  assertValidInput(input);

  const isUrl = isHttpUrl(input);
  logger.info(`Parsing OpenAPI spec from ${isUrl ? "URL" : "file"}: ${input}`);

  try {
    const api = (await SwaggerParser.dereference(input)) as unknown as OpenApiDocument;

    if (!api || typeof api !== "object") {
      throw new SpecParseError("Spec dereference returned empty result");
    }

    if (!api.openapi && !(api as unknown as Record<string, unknown>).swagger) {
      throw new SpecParseError(
        "Invalid OpenAPI spec: missing 'openapi' or 'swagger' version field"
      );
    }

    if (!api.paths || typeof api.paths !== "object" || Object.keys(api.paths).length === 0) {
      throw new SpecParseError("Invalid OpenAPI spec: missing or empty 'paths' object");
    }

    // Validate spec structure
    await SwaggerParser.validate(input).catch(() => {
      logger.warn("Spec validation warnings detected, continuing with dereferenced spec");
    });

    const baseUrl = extractBaseUrl(api, input);
    const title = api.info?.title ?? "Generated MCP Server";
    const version = api.info?.version ?? "0.1.0";

    logger.info(
      `Successfully parsed spec: ${title} v${version} (${Object.keys(api.paths).length} paths)`
    );

    return {
      raw: api as unknown as Record<string, unknown>,
      dereferenced: api,
      baseUrl,
      title,
      version,
    };
  } catch (err: unknown) {
    if (err instanceof SpecParseError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Provide clean CLI messages for common failures
    if (message.includes("ENOENT") || message.includes("no such file")) {
      throw new SpecParseError(`Spec file not found: ${input}`, err);
    }
    if (
      message.includes("fetch") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND")
    ) {
      throw new SpecParseError(`Failed to fetch remote spec URL: ${input} — ${message}`, err);
    }
    throw new SpecParseError(`Failed to parse OpenAPI spec: ${message}`, err);
  }
}

function extractBaseUrl(api: OpenApiDocument, input: string): string {
  // Priority: servers[0].url > input base if URL > fallback
  if (api.servers && api.servers.length > 0 && api.servers[0]?.url) {
    const serverUrl = api.servers[0].url;
    // Resolve relative server URLs against input if needed
    if (serverUrl.startsWith("/") && isHttpUrl(input)) {
      try {
        const inputUrl = new URL(input);
        return `${inputUrl.protocol}//${inputUrl.host}${serverUrl}`;
      } catch {
        return serverUrl;
      }
    }
    return serverUrl;
  }

  if (isHttpUrl(input)) {
    try {
      const url = new URL(input);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fallthrough
    }
  }

  return "http://localhost:3000";
}

export function isValidHttpMethod(method: string): boolean {
  return ["get", "post", "put", "delete", "patch"].includes(method.toLowerCase());
}
