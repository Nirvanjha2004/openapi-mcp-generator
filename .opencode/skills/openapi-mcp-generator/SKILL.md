---
name: openapi-mcp-generator
description: Use ONLY when generating an MCP server from an OpenAPI spec, wiring an OpenAPI API into opencode/Claude Desktop, or working with openapi-mcp-generator CLI. Triggers on keywords openapi, swagger, mcp generate, petstore, openapi.yaml.
---

# OpenAPI MCP Generator

Generate a standalone MCP server from any OpenAPI 3.0/3.1 spec and wire it into this opencode instance.

## Quick Commands

### 1. Generate a new MCP server

```bash
# from project root (openapi-mcp-generator must be built)
node ./dist/cli/index.js generate -i <spec> -o <outDir>
# examples:
node ./dist/cli/index.js generate -i ./examples/openapi.yaml -o ./generated/my-api
node ./dist/cli/index.js generate -i https://petstore3.swagger.io/api/v3/openapi.json -o ./generated/petstore-remote
npx openapi-mcp-generator generate -i ./openapi.json -o ./generated/my-api --base-url https://api.example.com
```

### 2. Validate without generating

```bash
node ./dist/cli/index.js validate -i ./examples/openapi.yaml
```

### 3. Wire into opencode (this project)

Project config is `opencode.jsonc` at repo root. Add:

```json
{
  "mcp": {
    "my-api": {
      "type": "local",
      "command": ["node", "generated/my-api/index.js"],
      "enabled": true,
      "environment": { "BASE_URL": "https://api.example.com", "BEARER_TOKEN": "{env:MY_TOKEN}" }
    }
  }
}
```

For global (all projects) edit `~/.config/opencode/opencode.jsonc` with absolute path:

```json
{
  "mcp": {
    "petstore": {
      "type": "local",
      "command": ["node", "C:/Users/nirva/Desktop/Projects/openapi-mcp-generator/generated/petstore-mcp/index.js"],
      "enabled": true
    }
  }
}
```

Then restart opencode. Verify:

```bash
opencode mcp list
# should show petstore ✓ connected
```

### 4. Wire into Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "petstore": {
      "command": "node",
      "args": ["C:/absolute/path/to/generated/petstore-mcp/index.js"],
      "env": { "BEARER_TOKEN": "xxx" }
    }
  }
}
```

### 5. Programmatic API

```ts
import { generateMcpServer } from "./dist/index.js"
await generateMcpServer({ input: "./examples/openapi.yaml", outputDir: "./generated/out" })
```

## Current Instance

- **Petstore MCP** already generated at `generated/petstore-mcp/` (7 tools: listPets, createPet, get_pets_by_petid, updatePet, deletePet, uploadPetPhoto, getInventory)
- **Config** `opencode.jsonc` (project) and `~/.config/opencode/opencode.jsonc` (global) both point to it
- Run `opencode mcp list` → petstore should be `connected`
- Prompt example: `use petstore tool listPets with limit 5`

## Troubleshooting

- `Tool not found` → check `command` path is absolute (global) or correct relative (project), file exists
- `ECONNREFUSED` → set `BASE_URL` env or fix `servers[0].url` in spec
- `HTTP 401` → set `BEARER_TOKEN` / `API_KEY` / `MCP_HEADER_X_*` in `environment`
- After changing `opencode.jsonc`, **quit and restart opencode** — config is loaded once at startup
