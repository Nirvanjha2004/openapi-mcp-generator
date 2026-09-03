import type { JsonSchema, JsonSchemaProperty, OpenApiParameter } from "../types.js";

/**
 * Convert an OpenAPI schema object to JSON Schema property.
 * Dereferenced specs have all $refs resolved, but we still handle anyOf/oneOf/allOf passthrough.
 */
export function toJsonSchemaProperty(schema: Record<string, unknown> | undefined): JsonSchemaProperty {
  if (!schema) {
    return { type: "string", description: "No schema provided" };
  }

  const prop: JsonSchemaProperty = {};

  const allowed = [
    "type",
    "format",
    "description",
    "enum",
    "default",
    "properties",
    "items",
    "required",
    "example",
    "examples",
    "anyOf",
    "oneOf",
    "allOf",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
  ] as const;

  for (const key of allowed) {
    if (key in schema) {
      (prop as Record<string, unknown>)[key] = schema[key];
    }
  }

  // Fallback type inference
  if (!prop.type && !prop.anyOf && !prop.oneOf && !prop.allOf && !prop.properties) {
    // If no type but has properties, assume object
    if (schema.properties) prop.type = "object";
    else prop.type = "string";
  }

  // Recursive handling for nested properties
  if (prop.properties && typeof prop.properties === "object") {
    const nested = prop.properties as Record<string, Record<string, unknown>>;
    const converted: Record<string, JsonSchemaProperty> = {};
    for (const [k, v] of Object.entries(nested)) {
      converted[k] = toJsonSchemaProperty(v);
    }
    prop.properties = converted;
  }

  if (prop.items && typeof prop.items === "object" && !Array.isArray(prop.items)) {
    prop.items = toJsonSchemaProperty(prop.items as Record<string, unknown>);
  }

  if (Array.isArray(prop.anyOf)) {
    prop.anyOf = (prop.anyOf as unknown as Record<string, unknown>[]).map(toJsonSchemaProperty);
  }
  if (Array.isArray(prop.oneOf)) {
    prop.oneOf = (prop.oneOf as unknown as Record<string, unknown>[]).map(toJsonSchemaProperty);
  }
  if (Array.isArray(prop.allOf)) {
    prop.allOf = (prop.allOf as unknown as Record<string, unknown>[]).map(toJsonSchemaProperty);
  }

  return prop;
}

export function buildInputSchema(
  parameters: OpenApiParameter[],
  requestBody: Record<string, unknown> | undefined,
  bodyRequired: boolean
): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  // Map parameters (path, query, header)
  for (const param of parameters) {
    if (param.in === "cookie") continue; // skip cookies for MCP
    const schema = toJsonSchemaProperty(param.schema as Record<string, unknown> | undefined);
    // Annotate description with source location
    const inDesc = param.in === "path" ? " (path)" : param.in === "query" ? " (query)" : " (header)";
    const description = param.description ? `${param.description}${inDesc}` : `Parameter in ${param.in}${inDesc}`;
    const prop: JsonSchemaProperty = {
      ...schema,
      description: description || schema.description,
    };
    properties[param.name] = prop;
    if (param.required) required.push(param.name);
  }

  // Map requestBody - only handle application/json
  if (requestBody) {
    const content = requestBody.content as Record<string, { schema?: Record<string, unknown> }> | undefined;
    let bodySchema: Record<string, unknown> | undefined;

    if (content) {
      // Prefer application/json, fallback to first content type
      if (content["application/json"]?.schema) {
        bodySchema = content["application/json"].schema;
      } else {
        const firstKey = Object.keys(content)[0];
        if (firstKey) bodySchema = content[firstKey]?.schema;
      }
    } else if ((requestBody as Record<string, unknown>).schema) {
      // Some specs inline schema (older)
      bodySchema = (requestBody as Record<string, unknown>).schema as Record<string, unknown>;
    }

    if (bodySchema) {
      const bodyProp = toJsonSchemaProperty(bodySchema);
      // If body is an object with properties, flatten into top-level for easier MCP usage
      // Instead, expose as single `body` field containing full schema, OR flatten?
      // We choose to flatten if it's an object with properties, but keep `body` wrapper to avoid collisions.
      // Hybrid: if bodyProp has properties, expose each as top-level with prefix or directly?
      // Common pattern: use `body` as object field.
      // For better UX, if body is object with properties, spread them as top-level.

      if (bodyProp.type === "object" && bodyProp.properties) {
        for (const [key, val] of Object.entries(bodyProp.properties)) {
          // Avoid collision with existing param names
          const finalKey = key in properties ? `body_${key}` : key;
          properties[finalKey] = val;
          if (bodyProp.required?.includes(key) && bodyRequired) {
            required.push(finalKey);
          }
        }
        // If body schema has no properties but is object, keep as 'body'
        if (Object.keys(bodyProp.properties).length === 0) {
          properties["body"] = bodyProp;
          if (bodyRequired) required.push("body");
        }
      } else {
        // Non-object body (e.g., array, string)
        properties["body"] = bodyProp;
        if (bodyRequired) required.push("body");
      }
    }
  }

  const schema: JsonSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };

  if (required.length > 0) schema.required = required;

  return schema;
}

export function isValidJsonSchema(schema: JsonSchema): boolean {
  return schema.type === "object" && typeof schema.properties === "object";
}
