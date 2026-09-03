export interface GenerateOptions {
  input: string;
  outputDir: string;
  serverName?: string;
  serverVersion?: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export interface GenerateResult {
  outputDir: string;
  toolCount: number;
  tools: McpToolDefinition[];
  serverName: string;
  serverVersion: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  _meta: {
    method: HttpMethod;
    path: string;
    operationId?: string;
  };
}

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface JsonSchemaProperty {
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  required?: string[];
  $ref?: string;
  // openapi extensions
  example?: unknown;
  examples?: unknown[];
  anyOf?: JsonSchemaProperty[];
  oneOf?: JsonSchemaProperty[];
  allOf?: JsonSchemaProperty[];
}

export interface ParsedRoute {
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, unknown>;
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchemaProperty;
  style?: string;
  explode?: boolean;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: JsonSchemaProperty; example?: unknown }>;
}

export interface RuntimeConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  headers?: Record<string, string>;
}

export interface AuthConfig {
  type: "bearer" | "apiKey" | "none";
  envVar?: string;
  headerName?: string;
}

export interface ExecutionArgs {
  [key: string]: unknown;
}

export interface ExecutionResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
