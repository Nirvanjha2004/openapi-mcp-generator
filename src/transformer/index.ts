import type { OpenApiDocument, OpenApiOperation } from "../parser/index.js";
import type { McpToolDefinition, HttpMethod, JsonSchema } from "../types.js";
import { deriveToolName, ensureUniqueNames } from "./naming.js";
import { buildInputSchema } from "./schema.js";
import { logger } from "../utils/logger.js";

const VALID_METHODS: HttpMethod[] = ["get", "post", "put", "delete", "patch"];

export interface TransformOptions {
  baseUrl?: string;
}

export function transformSpecToTools(
  doc: OpenApiDocument,
  options: TransformOptions = {}
): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];
  const rawNames: string[] = [];

  for (const [path, methods] of Object.entries(doc.paths)) {
    if (!methods || typeof methods !== "object") continue;

    for (const [methodRaw, operation] of Object.entries(methods as Record<string, OpenApiOperation>)) {
      const method = methodRaw.toLowerCase() as HttpMethod;
      if (!VALID_METHODS.includes(method)) continue;
      if (!operation || typeof operation !== "object") continue;

      const op = operation as OpenApiOperation;
      const name = deriveToolName(op.operationId, method, path);
      rawNames.push(name);

      const description =
        op.description?.trim() ||
        op.summary?.trim() ||
        `${method.toUpperCase()} ${path}`;

      // Collect parameters: path-level + operation-level (operation overrides)
      const pathLevelParams = (methods as Record<string, unknown>).parameters as
        | OpenApiOperation["parameters"]
        | undefined;

      const allParams = [
        ...(Array.isArray(pathLevelParams) ? pathLevelParams : []),
        ...(Array.isArray(op.parameters) ? op.parameters : []),
      ];

      // Deduplicate by name+in
      const deduped = new Map<string, (typeof allParams)[number]>();
      for (const p of allParams) {
        if (!p) continue;
        const key = `${p.in}:${p.name}`;
        deduped.set(key, p);
      }
      const parameters = Array.from(deduped.values()) as unknown as import("../types.js").OpenApiParameter[];

      const requestBody = op.requestBody as
        | { description?: string; required?: boolean; content?: Record<string, { schema?: Record<string, unknown> }> }
        | undefined;

      const inputSchema: JsonSchema = buildInputSchema(
        parameters,
        requestBody as unknown as Record<string, unknown> | undefined,
        Boolean(requestBody?.required)
      );

      tools.push({
        name, // will be uniquified below
        description,
        inputSchema,
        _meta: {
          method,
          path,
          operationId: op.operationId,
        },
      });
    }
  }

  // Ensure unique names after initial derivation
  const uniqueNames = ensureUniqueNames(rawNames);
  tools.forEach((tool, i) => {
    tool.name = uniqueNames[i] as string;
  });

  logger.info(`Transformed ${tools.length} operations into MCP tools`);

  if (tools.length === 0) {
    logger.warn("No valid operations found to transform - check that spec has GET/POST/PUT/DELETE/PATCH methods");
  }

  return tools;
}

export function validateToolName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}
