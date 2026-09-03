# openapi-mcp-generator

> **Generate a production-grade Model Context Protocol (MCP) server from any OpenAPI 3.0 / 3.1 spec — CLI + TypeScript library.**

[![npm version](https://img.shields.io/npm/v/openapi-mcp-generator?style=flat-square)](https://www.npmjs.com/package/openapi-mcp-generator)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](#)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](#)
[![Tests](https://img.shields.io/badge/tests-39%20passing-brightgreen?style=flat-square)](#testing)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue?style=flat-square)](#)

Turn any REST API described by OpenAPI into an MCP server that Claude Desktop, Cursor, or any MCP client can use **instantly** — no hand-written glue code.

```bash
npx openapi-mcp-generator generate -i ./openapi.yaml -o ./my-mcp-server
```

---

## ✨ Features

- **Universal OpenAPI support** — YAML, JSON, local file or remote URL; dereferences `$ref` via `@apidevtools/swagger-parser`
- **Accurate MCP tool mapping** — every `GET / POST / PUT / DELETE / PATCH` becomes an MCP Tool; `operationId` → tool name (fallback `method_path` slug), `description/summary` → tool description, parameters + `requestBody` → JSON Schema for `@modelcontextprotocol/sdk`
- **Production runtime** — `StdioServerTransport`, dynamic HTTP execution with `fetch`/`undici`, timeout + exponential-backoff retries, env-based auth, graceful error formatting
- **CLI + Library** — `npx` executable **and** programmatic `generateMcpServer(options)` API
- **Strict TypeScript** — `strict` + `noUncheckedIndexedAccess`, zero `any`, explicit types for routes/options/handlers
- **Clean build** — `tsup` dual ESM/CJS, `eslint` + `prettier`, `vitest` suite

---

## 🏗 Architecture

```
openapi-mcp-generator/
├── src/
│   ├── parser/         # SwaggerParser dereference + validation (file / URL)
│   ├── transformer/    # OpenAPI → MCP Tool:
│   │   ├── naming.ts   #   sanitize operationId / slug fallback + unique suffix
│   │   ├── schema.ts   #   OpenAPI params + requestBody → JSON Schema
│   │   └── index.ts    #   orchestration + path-level param dedup
│   ├── runtime/        # Live MCP server:
│   │   ├── server.ts   #   Server + StdioServerTransport + handlers
│   │   ├── executor.ts #   path/query/header/body mapping + fetch + retry
│   │   └── auth.ts     #   BEARER_TOKEN / API_KEY / MCP_HEADER_* → headers
│   ├── generator/      # Code emitter → writes standalone server to outDir
│   ├── cli/            # commander – generate / validate
│   ├── utils/          # logger, typed errors, validation
│   └── index.ts        # public programmatic API
├── examples/
│   ├── openapi.yaml    # Pet Store sample (7 operations)
│   └── openapi.json    # Minimal JSON sample
├── tests/              # vitest – parser / transformer / runtime / integration
└── dist/               # tsup ESM + CJS + DTS
```

**Request flow (runtime)**

```
MCP Client (Claude) --callTool--> Server --executor--> map args:
  path params  → URL template (/pets/{id})
  query params → URLSearchParams
  header params→ headers
  body props   → JSON.stringify(body)
                          + auth headers (env)
                          + timeout / retry
                       --fetch--> Your REST API --> formatted text/JSON back to client
```

---

## 📦 Installation

### CLI (recommended)

```bash
# One-shot (no install)
npx openapi-mcp-generator generate -i ./openapi.yaml -o ./my-mcp-server

# Global install
npm i -g openapi-mcp-generator
openapi-mcp-generator --help
```

### Library

```bash
npm i openapi-mcp-generator
```

Requires **Node.js ≥ 18**.

---

## 🚀 CLI Usage

### Generate

```bash
openapi-mcp-generator generate \
  -i ./examples/openapi.yaml \
  -o ./my-mcp-server \
  --name pet-store-mcp \
  --base-url https://api.example.com/v1 \
  --timeout 15000 \
  --retries 2
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `-i, --input <spec>` | ✅ | — | OpenAPI file path or remote URL (`*.yaml`, `*.json`) |
| `-o, --output <dir>` | ✅ | — | Directory to emit the standalone MCP server |
| `-n, --name <name>` |  | OpenAPI `info.title` | MCP server name |
| `--server-version <v>` | | OpenAPI `info.version` | Server version |
| `--base-url <url>` | | `servers[0].url` or `http://localhost:3000` | Override API base URL |
| `--timeout <ms>` | | `10000` | Fetch timeout per attempt |
| `--retries <n>` | | `1` | Retry count (exponential backoff) |

**Validate only (no generation):**

```bash
openapi-mcp-generator validate -i https://petstore3.swagger.io/api/v3/openapi.json
# ✓ Valid spec: Swagger Petstore - OpenAPI 3.0 v1.0.19
#   Base URL: https://petstore3.swagger.io/api/v3
#   Paths: 13
#   Tools: 19
```

### What gets generated?

```
my-mcp-server/
├── package.json   # dependencies: @modelcontextprotocol/sdk, undici
├── index.js       # standalone MCP server (StdioServerTransport)
├── README.md      # usage + tool list
└── .env.example   # auth & BASE_URL hints
```

Run it:

```bash
cd my-mcp-server
npm install
node index.js          # starts MCP on stdio
```

Auth example:

```bash
BEARER_TOKEN=eyJ... API_KEY=abc123 node index.js
MCP_HEADER_X_TENANT=acme node index.js
```

---

## 📚 Programmatic API

```typescript
import { generateMcpServer, parseSpec, transformSpecToTools, createMcpServer } from "openapi-mcp-generator";

// 1. Full codegen (writes files)
const result = await generateMcpServer({
  input: "./examples/openapi.yaml",   // or "https://..." or "./openapi.json"
  outputDir: "./generated",
  serverName: "pet-store-mcp",        // optional
  serverVersion: "1.0.0",             // optional
  baseUrl: "https://api.example.com", // optional override
  timeout: 10000,
  retries: 1,
});
console.log(result.toolCount, result.tools);

// 2. Lower-level primitives
const parsed = await parseSpec("./openapi.yaml"); // dereferenced + baseUrl
const tools = transformSpecToTools(parsed.dereferenced);
const server = createMcpServer({
  name: "my-server",
  version: "1.0.0",
  tools,
  baseUrl: parsed.baseUrl,
});
```

**Types**

```typescript
import type { GenerateOptions, GenerateResult, McpToolDefinition, JsonSchema } from "openapi-mcp-generator";
```

---

## 🔐 Authentication

Generated servers read auth **entirely from environment** — no hardcoded secrets:

| Env var | Sent as |
|---------|---------|
| `BEARER_TOKEN` or `API_TOKEN` | `Authorization: Bearer <value>` |
| `API_KEY` | `x-api-key: <value>` (or custom `--headerName`) |
| `MCP_HEADER_<NAME>` | `<NAME lower + - >: <value>` → e.g. `MCP_HEADER_X_CUSTOM=1` → `x-custom: 1` |

Set them via shell, CI, or `claude_desktop_config.json` `env` block (see below).

---

## 🖥 Claude Desktop Integration (Step-by-Step)

### 1. Generate the server

```bash
npx openapi-mcp-generator generate -i ./examples/openapi.yaml -o ./petstore-mcp
cd petstore-mcp && npm install
```

### 2. Find your config file

| OS | Path |
|----|------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` (if supported) |

Create the file if it does not exist.

### 3. Register the MCP server

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "petstore": {
      "command": "node",
      "args": ["C:/absolute/path/to/petstore-mcp/index.js"],
      "env": {
        "BASE_URL": "https://api.example.com/v1",
        "BEARER_TOKEN": "your_token_here",
        "API_KEY": "your_api_key_if_needed"
      }
    }
  }
}
```

> **Windows note:** Use forward slashes or escaped backslashes in the `args` path.
> Use an **absolute** path — Claude's working directory is not your project dir.

### 4. Restart Claude Desktop

Quit and reopen Claude. Click the **🔌** (tools) icon in a new chat — you should see:

- `listPets`
- `createPet`
- `get_pets_by_petid`
- `updatePet`
- `deletePet`
- `uploadPetPhoto`
- `getInventory`

### 5. Try a prompt

```
Use listPets to show me available pets with limit 5, then create a pet named "Wally".
```

**Troubleshooting**

- `Tool not found` → check `args` path is absolute and file exists.
- `Failed to fetch` / `ECONNREFUSED` → verify `BASE_URL` or spec `servers[0].url`.
- `HTTP 401` → set `BEARER_TOKEN`/`API_KEY` in the `env` block.
- Enable debug: add `"DEBUG": "1"` to `env` and watch Claude logs:
  - macOS: `~/Library/Logs/Claude/mcp*.log`
  - Windows: `%APPDATA%\Claude\logs\mcp*.log`

---

## 🧪 Examples

The repo ships two ready-to-use specs:

```bash
# YAML – Pet Store (7 tools)
npx openapi-mcp-generator generate -i ./examples/openapi.yaml -o ./tmp/petstore

# JSON – minimal hello
npx openapi-mcp-generator generate -i ./examples/openapi.json -o ./tmp/hello

# Remote URL
npx openapi-mcp-generator generate -i https://petstore3.swagger.io/api/v3/openapi.json -o ./tmp/remote
```

---

## 🔧 Development

```bash
git clone https://github.com/<you>/openapi-mcp-generator.git
cd openapi-mcp-generator
npm install
npm run build        # tsup ESM + CJS + DTS
npm test             # vitest (39 tests)
npm run test:coverage
npm run lint         # eslint (flat config)
npm run format       # prettier
npm run typecheck    # tsc --noEmit
```

Project conventions:

- TypeScript **strict** mode, `noUncheckedIndexedAccess`, zero `any`.
- `undici` / native `fetch` with `AbortController` timeout.
- Commit style: `feat(parser): ...`, `fix(runtime): ...`, `docs: ...`.

---

## 🧪 Testing

Tests use **vitest** + mocked `fetch`:

- `tests/parser.test.ts` — valid/invalid specs, `$ref` dereferencing, remote-file handling
- `tests/transformer.test.ts` — `operationId` vs `method_path` fallback, unique suffix, JSON Schema flattening
- `tests/runtime.test.ts` — mocked HTTP: path/query/header/body mapping, 401/404 handling, timeout + retry, auth headers
- `tests/integration.test.ts` — end-to-end `generateMcpServer` writes `index.js`, `package.json`, etc.

```bash
npm test
# Test Files  4 passed (4)
#      Tests  39 passed (39)
```

---

## 🤝 Contributing

PRs welcome! Please:

1. Run `npm run lint` + `npm test` + `npm run typecheck`.
2. Follow conventional commits.
3. Add tests for new behavior.

---

## 📄 License

MIT © openapi-mcp-generator — see [LICENSE](./LICENSE).

---

## 🙏 Acknowledgements

- [@apidevtools/swagger-parser](https://github.com/APIDevTools/swagger-parser) for robust dereferencing
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) for the MCP runtime
- [commander](https://github.com/tj/commander.js) for CLI ergonomics
