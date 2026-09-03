import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpToolDefinition } from "../types.js";
import { createExecutor } from "./executor.js";
import { logger } from "../utils/logger.js";

export interface McpServerOptions {
  name: string;
  version: string;
  tools: McpToolDefinition[];
  baseUrl: string;
  timeout?: number;
  retries?: number;
}

export function createMcpServer(options: McpServerOptions): Server {
  const { name, version, tools, baseUrl } = options;
  const timeout = options.timeout ?? 10000;
  const retries = options.retries ?? 1;

  const server = new Server(
    {
      name,
      version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  const executor = createExecutor({
    baseUrl,
    timeout,
    retries,
    toolMap,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    logger.info(`Tool called: ${toolName} with args: ${JSON.stringify(args)}`);

    const result = await executor.execute(toolName, args);
    return result as unknown as { content: Array<{ type: string; text: string }>; isError?: boolean };
  });

  return server;
}

export async function startStdioServer(options: McpServerOptions): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`MCP server "${options.name}" v${options.version} started on stdio`);
  logger.info(`Base URL: ${options.baseUrl} | Tools: ${options.tools.length}`);
}
