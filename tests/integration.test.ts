import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { generateMcpServer } from "../src/index.js";

describe("integration - generateMcpServer", () => {
  it("generates a standalone MCP server from YAML spec", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-gen-test-"));
    const outDir = path.join(tmpDir, "output");

    const result = await generateMcpServer({
      input: "examples/openapi.yaml",
      outputDir: outDir,
      serverName: "test-pet-store",
      serverVersion: "0.0.1",
    });

    expect(result.toolCount).toBe(7);
    expect(result.serverName).toBe("test-pet-store");
    expect(result.outputDir).toBe(path.resolve(outDir));

    // Check generated files exist
    const files = await fs.readdir(outDir);
    expect(files).toContain("package.json");
    expect(files).toContain("index.js");
    expect(files).toContain("README.md");
    expect(files).toContain(".env.example");

    const pkg = JSON.parse(await fs.readFile(path.join(outDir, "package.json"), "utf-8")) as Record<string, unknown>;
    expect(pkg.name).toBe("test-pet-store");

    const serverCode = await fs.readFile(path.join(outDir, "index.js"), "utf-8");
    expect(serverCode).toContain("StdioServerTransport");
    expect(serverCode).toContain("listPets");
    expect(serverCode).toContain("BASE_URL");

    const readme = await fs.readFile(path.join(outDir, "README.md"), "utf-8");
    expect(readme).toContain("test-pet-store");
  });

  it("generates with custom baseUrl override", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-gen-test-"));
    const outDir = path.join(tmpDir, "out2");

    const result = await generateMcpServer({
      input: "examples/openapi.json",
      outputDir: outDir,
      baseUrl: "https://override.example.com",
    });

    expect(result.tools.length).toBe(1);
    const code = await fs.readFile(path.join(outDir, "index.js"), "utf-8");
    expect(code).toContain("https://override.example.com");
  });

  it("handles missing input gracefully", async () => {
    await expect(
      generateMcpServer({ input: "", outputDir: "./tmp" })
    ).rejects.toThrow();
  });
});
