#!/usr/bin/env node
import { Command } from "commander";
import * as path from "node:path";
import { generateMcpServer } from "../generator/index.js";
import { logger } from "../utils/logger.js";

const program = new Command();

program
  .name("openapi-mcp-generator")
  .description("Generate a standalone MCP server from an OpenAPI 3.0/3.1 spec")
  .version("0.1.0");

program
  .command("generate")
  .description("Generate an MCP server from an OpenAPI spec")
  .requiredOption("-i, --input <spec>", "Input OpenAPI spec file path or URL (.yaml, .json)")
  .requiredOption("-o, --output <dir>", "Output directory for the generated MCP server")
  .option("-n, --name <name>", "MCP server name (defaults to OpenAPI title)")
  .option("--server-version <version>", "MCP server version (defaults to OpenAPI version)")
  .option("--base-url <url>", "Override base URL for API requests")
  .option("--timeout <ms>", "HTTP request timeout in milliseconds", "10000")
  .option("--retries <count>", "Number of retries for failed requests", "1")
  .action(async opts => {
    try {
      const input: string = opts.input;
      const output: string = path.resolve(opts.output);
      const timeout = Number.parseInt(opts.timeout, 10);
      const retries = Number.parseInt(opts.retries, 10);

      if (Number.isNaN(timeout) || timeout <= 0) {
        console.error("Error: --timeout must be a positive number");
        process.exit(1);
      }
      if (Number.isNaN(retries) || retries < 0) {
        console.error("Error: --retries must be a non-negative number");
        process.exit(1);
      }

      logger.info(`Generating MCP server from ${input} -> ${output}`);

      const result = await generateMcpServer({
        input,
        outputDir: output,
        serverName: opts.name,
        serverVersion: opts.serverVersion,
        baseUrl: opts.baseUrl,
        timeout,
        retries,
      });

      console.log("\n✓ MCP server generated successfully!");
      console.log(`  Name: ${result.serverName} v${result.serverVersion}`);
      console.log(`  Output: ${result.outputDir}`);
      console.log(`  Tools: ${result.toolCount}`);
      console.log("\nNext steps:");
      console.log(`  1. cd ${output}`);
      console.log("  2. npm install");
      console.log("  3. Configure Claude Desktop (see README.md)");
      console.log("  4. node index.js  # test run\n");

      for (const tool of result.tools) {
        console.log(`  - ${tool.name}  (${tool._meta.method.toUpperCase()} ${tool._meta.path})`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n✗ Generation failed: ${message}`);
      if (process.env.DEBUG && err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      if (err instanceof Error && "cause" in err && err.cause) {
        console.error(`Cause: ${String(err.cause)}`);
      }
      process.exit(1);
    }
  });

program
  .command("validate")
  .description("Validate an OpenAPI spec without generating")
  .requiredOption("-i, --input <spec>", "Input spec path or URL")
  .action(async opts => {
    try {
      const { parseSpec } = await import("../parser/index.js");
      const { transformSpecToTools } = await import("../transformer/index.js");
      const parsed = await parseSpec(opts.input);
      const tools = transformSpecToTools(parsed.dereferenced);
      console.log(`✓ Valid spec: ${parsed.title} v${parsed.version}`);
      console.log(`  Base URL: ${parsed.baseUrl}`);
      console.log(`  Paths: ${Object.keys(parsed.dereferenced.paths).length}`);
      console.log(`  Tools: ${tools.length}`);
      for (const t of tools) console.log(`  - ${t.name}: ${t.description}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ Validation failed: ${message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
