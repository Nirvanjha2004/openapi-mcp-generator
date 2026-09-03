import { describe, it, expect } from "vitest";
import { deriveToolName, sanitizeToolName, slugify, ensureUniqueNames } from "../src/transformer/naming.js";
import { buildInputSchema, toJsonSchemaProperty } from "../src/transformer/schema.js";
import { transformSpecToTools } from "../src/transformer/index.js";
import type { OpenApiDocument } from "../src/parser/index.js";

describe("transformer/naming", () => {
  it("slugifies correctly", () => {
    expect(slugify("GET /pets/{id}")).toBe("get_pets_id");
    expect(slugify("Hello World!")).toBe("hello_world");
  });

  it("sanitizes tool names to MCP spec", () => {
    expect(sanitizeToolName("my-tool.name")).toBe("my-tool_name");
    expect(sanitizeToolName("a".repeat(100)).length).toBeLessThanOrEqual(64);
    expect(sanitizeToolName("")).toBe("unnamed_tool");
    expect(sanitizeToolName("valid_name-123")).toBe("valid_name-123");
  });

  it("derives name from operationId", () => {
    expect(deriveToolName("listPets", "get", "/pets")).toBe("listPets");
  });

  it("derives name from method+path fallback", () => {
    const name = deriveToolName(undefined, "get", "/pets/{petId}");
    expect(name).toBe("get_pets_by_petId");
  });

  it("ensures unique names with suffix", () => {
    expect(ensureUniqueNames(["a", "a", "a"])).toEqual(["a", "a_2", "a_3"]);
    expect(ensureUniqueNames(["x", "y"])).toEqual(["x", "y"]);
  });

  it("handles duplicate operationIds by suffixing", () => {
    const doc: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/a": { get: { operationId: "dup", responses: {} } as never },
        "/b": { get: { operationId: "dup", responses: {} } as never },
      },
    };
    const tools = transformSpecToTools(doc);
    expect(tools[0]?.name).toBe("dup");
    expect(tools[1]?.name).toBe("dup_2");
  });
});

describe("transformer/schema", () => {
  it("toJsonSchemaProperty handles nested object", () => {
    const prop = toJsonSchemaProperty({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    });
    expect(prop.type).toBe("object");
    expect(prop.properties?.name.type).toBe("string");
  });

  it("buildInputSchema maps query/path/header correctly", () => {
    const schema = buildInputSchema(
      [
        { name: "petId", in: "path", required: true, schema: { type: "string" }, description: "ID" },
        { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        { name: "X-Api-Key", in: "header", required: false, schema: { type: "string" } },
      ],
      undefined,
      false
    );
    expect(schema.properties["petId"]).toBeDefined();
    expect(schema.properties["petId"].description).toContain("(path)");
    expect(schema.properties["limit"].description).toContain("(query)");
    expect(schema.properties["X-Api-Key"].description).toContain("(header)");
    expect(schema.required).toContain("petId");
    expect(schema.required).not.toContain("limit");
  });

  it("buildInputSchema flattens JSON body properties", () => {
    const schema = buildInputSchema(
      [],
      {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                tag: { type: "string" },
              },
              required: ["name"],
            },
          },
        },
      } as unknown as Record<string, unknown>,
      true
    );
    expect(schema.properties["name"]).toBeDefined();
    expect(schema.properties["tag"]).toBeDefined();
    expect(schema.required).toContain("name");
  });

  it("buildInputSchema handles non-object body as body field", () => {
    const schema = buildInputSchema(
      [],
      {
        content: {
          "application/json": { schema: { type: "array", items: { type: "string" } } },
        },
      } as unknown as Record<string, unknown>,
      true
    );
    expect(schema.properties["body"]).toBeDefined();
    expect(schema.properties["body"].type).toBe("array");
  });

  it("ignores cookie params", () => {
    const schema = buildInputSchema(
      [{ name: "session", in: "cookie", schema: { type: "string" } } as never],
      undefined,
      false
    );
    expect(schema.properties["session"]).toBeUndefined();
  });
});

describe("transformer/index - transformSpecToTools", () => {
  it("transforms pet store spec to correct tool count and names", async () => {
    const { parseSpec } = await import("../src/parser/index.js");
    const parsed = await parseSpec("examples/openapi.yaml");
    const tools = transformSpecToTools(parsed.dereferenced);
    // /pets GET, POST, /pets/{petId} GET, PUT, DELETE, /pets/{petId}/photos POST, /store/inventory GET = 7? let's count
    // pet store yaml: /pets (2), /pets/{petId} (3), /pets/{petId}/photos (1), /store/inventory (1) = 7
    expect(tools.length).toBe(7);
    const names = tools.map((t) => t.name);
    expect(names).toContain("listPets");
    expect(names).toContain("createPet");
    expect(names).toContain("updatePet");
    expect(names).toContain("getInventory");
    // fallback name for GET /pets/{petId} (no operationId)
    expect(names).toContain("get_pets_by_petId");
  });

  it("uses description fallback when summary missing", () => {
    const doc: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: "T", version: "1.0.0" },
      paths: {
        "/no-desc": {
          get: {
            responses: {},
          } as never,
        },
      },
    };
    const tools = transformSpecToTools(doc);
    expect(tools[0]?.description).toBe("GET /no-desc");
  });

  it("only includes valid HTTP methods", () => {
    const doc: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: "T", version: "1.0.0" },
      paths: {
        "/test": {
          get: { operationId: "ok", responses: {} } as never,
          trace: { operationId: "bad", responses: {} } as never,
          options: { operationId: "bad2", responses: {} } as never,
        },
      },
    };
    const tools = transformSpecToTools(doc);
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("ok");
  });

  it("deduplicates path-level and operation parameters", () => {
    const doc: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: "T", version: "1.0.0" },
      paths: {
        "/items/{id}": {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          get: {
            operationId: "getItem",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: {},
          } as never,
        },
      },
    };
    const tools = transformSpecToTools(doc);
    expect(tools[0]?.inputSchema.properties["id"]).toBeDefined();
    // should only have one id prop
    expect(Object.keys(tools[0]?.inputSchema.properties ?? {})).toEqual(["id"]);
  });
});
