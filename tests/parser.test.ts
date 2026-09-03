import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseSpec } from "../src/parser/index.js";

const fixturesDir = path.resolve("tests/fixtures");
const exampleYaml = path.resolve("examples/openapi.yaml");
const exampleJson = path.resolve("examples/openapi.json");

describe("parser - parseSpec", () => {
  it("parses valid YAML spec from local file", async () => {
    const result = await parseSpec(exampleYaml);
    expect(result.title).toBe("Pet Store API");
    expect(result.version).toBe("1.0.0");
    expect(result.baseUrl).toBe("https://api.example.com/v1");
    expect(Object.keys(result.dereferenced.paths)).toContain("/pets");
    expect(Object.keys(result.dereferenced.paths)).toContain("/pets/{petId}");
  });

  it("parses valid JSON spec from local file", async () => {
    const result = await parseSpec(exampleJson);
    expect(result.title).toBe("Simple JSON Example");
    expect(result.dereferenced.paths["/hello"]).toBeDefined();
    expect(result.dereferenced.paths["/hello"]?.get?.operationId).toBe("sayHello");
  });

  it("dereferences $ref schemas", async () => {
    const result = await parseSpec(exampleYaml);
    const petsGet = result.dereferenced.paths["/pets"]?.get;
    // After dereference, $ref should be resolved - check NewPet is inline
    expect(petsGet).toBeDefined();
    // POST /pets has requestBody with Pet schema dereferenced
    const postOp = result.dereferenced.paths["/pets"]?.post;
    const schema = postOp?.requestBody?.content?.["application/json"]?.schema as Record<
      string,
      unknown
    >;
    expect(schema).toBeDefined();
    // Should have properties, not $ref
    expect(schema.type).toBe("object");
    expect(schema.properties as Record<string, unknown>).toHaveProperty("name");
  });

  it("throws SpecParseError for non-existent file", async () => {
    await expect(parseSpec("./non-existent-spec.yaml")).rejects.toThrow(
      /Spec file not found|Failed to parse/
    );
  });

  it("throws for invalid spec - missing paths", async () => {
    const tmp = path.join(fixturesDir, "invalid-missing-paths.yaml");
    await fs.mkdir(fixturesDir, { recursive: true });
    await fs.writeFile(
      tmp,
      "openapi: 3.0.3\ninfo:\n  title: Bad\n  version: 1.0.0\npaths: {}\n",
      "utf-8"
    );
    await expect(parseSpec(tmp)).rejects.toThrow(/empty 'paths'|Invalid OpenAPI/);
  });

  it("throws for empty input", async () => {
    await expect(parseSpec("")).rejects.toThrow(/non-empty string/);
    // @ts-expect-error testing runtime validation
    await expect(parseSpec(null)).rejects.toThrow();
  });

  it("handles spec with no servers -> fallback baseUrl", async () => {
    const tmp = path.join(fixturesDir, "no-servers.yaml");
    await fs.writeFile(
      tmp,
      `
openapi: 3.0.3
info:
  title: No Servers
  version: 1.0.0
paths:
  /test:
    get:
      operationId: testOp
      responses:
        "200":
          description: ok
`.trim(),
      "utf-8"
    );
    const result = await parseSpec(tmp);
    expect(result.baseUrl).toBe("http://localhost:3000");
  });

  it("isValidHttpMethod helper works", async () => {
    const { isValidHttpMethod } = await import("../src/parser/index.js");
    expect(isValidHttpMethod("get")).toBe(true);
    expect(isValidHttpMethod("POST")).toBe(true);
    expect(isValidHttpMethod("trace")).toBe(false);
  });
});
