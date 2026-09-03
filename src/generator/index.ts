import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseSpec } from "../parser/index.js";
import { transformSpecToTools } from "../transformer/index.js";
import type { GenerateOptions, GenerateResult, McpToolDefinition } from "../types.js";
import { GenerationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { sanitizeServerName } from "../utils/validation.js";

export async function generateMcpServer(options: GenerateOptions): Promise<GenerateResult> {
  const { input, outputDir } = options;

  if (!input) throw new GenerationError("Missing required option: input");
  if (!outputDir) throw new GenerationError("Missing required option: outputDir");

  const parsed = await parseSpec(input);
  const baseUrl = options.baseUrl ?? parsed.baseUrl;
  const tools = transformSpecToTools(parsed.dereferenced, { baseUrl });

  const serverName = sanitizeServerName(options.serverName ?? parsed.title, "mcp-server");
  const serverVersion = options.serverVersion ?? parsed.version ?? "0.1.0";

  await writeGeneratedServer({
    outputDir,
    serverName,
    serverVersion,
    baseUrl,
    tools,
    timeout: options.timeout ?? 10000,
    retries: options.retries ?? 1,
  });

  logger.info(`Generated MCP server at ${outputDir} with ${tools.length} tools`);

  return {
    outputDir: path.resolve(outputDir),
    toolCount: tools.length,
    tools,
    serverName,
    serverVersion,
  };
}

interface WriteOptions {
  outputDir: string;
  serverName: string;
  serverVersion: string;
  baseUrl: string;
  tools: McpToolDefinition[];
  timeout: number;
  retries: number;
}

async function writeGeneratedServer(writeOptions: WriteOptions): Promise<void> {
  const { outputDir, serverName, serverVersion, baseUrl, tools, timeout, retries } = writeOptions;

  await fs.mkdir(outputDir, { recursive: true });

  // package.json for generated server
  const pkg = {
    name: serverName,
    version: serverVersion,
    description: `MCP server generated from OpenAPI spec - ${serverName}`,
    type: "module",
    main: "index.js",
    scripts: {
      start: "node index.js",
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.12.0",
      undici: "^7.8.0",
    },
  };

  await fs.writeFile(path.join(outputDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");

  // index.js - standalone MCP server runtime
  const serverCode = generateServerCode({
    serverName,
    serverVersion,
    baseUrl,
    tools,
    timeout,
    retries,
  });

  await fs.writeFile(path.join(outputDir, "index.js"), serverCode, "utf-8");

  // README for generated server
  const readme = `# ${serverName}

Generated MCP server from OpenAPI spec.

- **Version:** ${serverVersion}
- **Base URL:** \`${baseUrl}\`
- **Tools:** ${tools.length}

## Run

\`\`\`bash
npm install
node index.js
\`\`\`

Environment variables for auth:

- \`BEARER_TOKEN\` - Bearer token for Authorization header
- \`API_KEY\` - API key (sent as x-api-key)
- \`MCP_HEADER_<NAME>\` - Custom header, e.g. \`MCP_HEADER_X_CUSTOM=value\`

## Claude Desktop Config

Add to your \`claude_desktop_config.json\`:

\`\`\`json
{
  "mcpServers": {
    "${serverName}": {
      "command": "node",
      "args": ["${path.resolve(outputDir)}/index.js"],
      "env": {
        "BEARER_TOKEN": "your_token_here"
      }
    }
  }
}
\`\`\`

## Tools

${tools.map(t => `- \`${t.name}\` - ${t.description} (${t._meta.method.toUpperCase()} ${t._meta.path})`).join("\n")}
`;

  await fs.writeFile(path.join(outputDir, "README.md"), readme, "utf-8");

  // .env example
  const envExample = `# Authentication
# BEARER_TOKEN=your_bearer_token
# API_KEY=your_api_key
# MCP_HEADER_X_CUSTOM=custom_value

# Server
BASE_URL=${baseUrl}
`;
  await fs.writeFile(path.join(outputDir, ".env.example"), envExample, "utf-8");
}

function generateServerCode(opts: {
  serverName: string;
  serverVersion: string;
  baseUrl: string;
  tools: McpToolDefinition[];
  timeout: number;
  retries: number;
}): string {
  const { serverName, serverVersion, baseUrl, tools, timeout, retries } = opts;

  // Serialize tools safely
  const toolsJson = JSON.stringify(tools, null, 2);

  return `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = ${JSON.stringify(serverName)};
const SERVER_VERSION = ${JSON.stringify(serverVersion)};
const BASE_URL = process.env.BASE_URL || ${JSON.stringify(baseUrl)};
const TIMEOUT = Number(process.env.TIMEOUT) || ${timeout};
const RETRIES = Number(process.env.RETRIES) || ${retries};

const TOOLS = ${toolsJson};

function getAuthHeaders() {
  const headers = {};
  const bearer = process.env.BEARER_TOKEN || process.env.API_TOKEN;
  if (bearer) {
    headers["Authorization"] = bearer.startsWith("Bearer ") ? bearer : \`Bearer \${bearer}\`;
  }
  const apiKey = process.env.API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MCP_HEADER_") && value) {
      const headerName = key.replace("MCP_HEADER_", "").toLowerCase().replace(/_/g, "-");
      headers[headerName] = value;
    }
  }
  return headers;
}

function buildUrl(baseUrl, pathTemplate, args, schema, method) {
  let urlPath = pathTemplate;
  const pathParams = urlPath.match(/{([^}]+)}/g) || [];
  for (const m of pathParams) {
    const key = m.slice(1, -1);
    if (args[key] !== undefined && args[key] !== null) {
      urlPath = urlPath.replace(m, encodeURIComponent(String(args[key])));
    }
  }
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const cleanPath = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
  const url = new URL(cleanPath, base);
  const pathParamNames = pathParams.map(m => m.slice(1, -1));
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (pathParamNames.includes(k)) continue;
    if (v === undefined || v === null) continue;
    const prop = schema.properties[k];
    const desc = prop?.description || "";
    if (desc.includes("(header)") || desc.includes("(path)")) continue;
    const noMarker = !desc.includes("(") && prop !== undefined;
    if (noMarker && ["post","put","patch"].includes(method.toLowerCase())) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) continue;
    const isQuery = desc.includes("(query)");
    if (isQuery || (["get","delete"].includes(method.toLowerCase()) && !desc.includes("("))) {
      if (Array.isArray(v)) v.forEach(val => params.append(k, String(val)));
      else params.append(k, String(v));
    } else if (isQuery) {
      if (Array.isArray(v)) v.forEach(val => params.append(k, String(val)));
      else params.append(k, String(v));
    }
  }
  // fallback ensure query-marked
  for (const [k,v] of Object.entries(args)) {
    if (params.has(k)) continue;
    if (pathParamNames.includes(k)) continue;
    const prop = TOOLS.find(t=>true)?.inputSchema?.properties?.[k];
    // we rely on above loop's desc check - simplified
  }
  if (params.toString()) url.search = params.toString();
  return url.toString();
}

function buildHeadersAndBody(args, tool) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  const body = {};
  let hasBody = false;
  for (const [k,v] of Object.entries(args)) {
    const prop = tool.inputSchema.properties[k];
    const desc = prop?.description || "";
    if (desc.includes("(header)")) { headers[k] = String(v); continue; }
    if (desc.includes("(path)") || desc.includes("(query)")) continue;
    if (["post","put","patch"].includes(tool._meta.method)) {
      if (desc.includes("(query)")) continue;
      body[k]=v; hasBody=true;
    }
  }
  if ("body" in args && tool.inputSchema.properties["body"] && !hasBody) {
    const raw = args["body"];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return { headers, body: raw };
    if (raw !== undefined) return { headers, body: { value: raw } };
  }
  return { headers, body: hasBody ? body : undefined };
}

async function executeTool(toolName, args) {
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) return { content: [{ type: "text", text: "Tool not found: " + toolName }], isError: true };
  const url = buildUrl(BASE_URL, tool._meta.path, args, tool.inputSchema, tool._meta.method);
  const { headers, body } = buildHeadersAndBody(args, tool);
  const finalHeaders = { ...headers, ...getAuthHeaders() };
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), TIMEOUT);
      const res = await fetch(url, { method: tool._meta.method.toUpperCase(), headers: finalHeaders, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      clearTimeout(t);
      const ct = res.headers.get("content-type") || "";
      let text;
      if (ct.includes("application/json")) text = JSON.stringify(await res.json(), null, 2);
      else text = await res.text();
      if (!res.ok) return { content: [{ type: "text", text: "HTTP " + res.status + " " + res.statusText + "\\n" + text }], isError: true };
      const statusLine = "Status: " + res.status + " " + res.statusText;
      return { content: [{ type: "text", text: text ? statusLine + "\\n\\n" + text : statusLine }] };
    } catch (e) {
      lastError = e;
      const isAbort = e && e.name === "AbortError";
      if (attempt < RETRIES) { await new Promise(r=>setTimeout(r, 100*Math.pow(2, attempt))); continue; }
      const msg = isAbort ? "Request timed out after " + TIMEOUT + "ms" : "Execution failed: " + (e.message || String(e));
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  }
  throw lastError;
}

const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const r = await executeTool(req.params.name, req.params.arguments || {});
  return r;
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server '" + SERVER_NAME + "' v" + SERVER_VERSION + " started on stdio | Base URL: " + BASE_URL + " | Tools: " + TOOLS.length);
}

main().catch(err => { console.error("Failed to start MCP server:", err); process.exit(1); });
`;
}
