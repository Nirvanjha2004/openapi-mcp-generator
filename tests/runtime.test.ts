import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createExecutor, extractPathParamNames } from "../src/runtime/executor.js";
import { getAuthHeaders } from "../src/runtime/auth.js";
import type { McpToolDefinition } from "../src/types.js";

function makeTool(overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
  return {
    name: "listPets",
    description: "List pets",
    inputSchema: {
      type: "object",
      properties: {
        petId: { type: "string", description: "ID (path)" },
        limit: { type: "integer", description: "Limit (query)" },
        "X-Request-Id": { type: "string", description: "Request id (header)" },
      },
      required: ["petId"],
    },
    _meta: { method: "get", path: "/pets/{petId}" },
    ...overrides,
  };
}

describe("runtime/auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns bearer token header", () => {
    process.env.BEARER_TOKEN = "secret123";
    const headers = getAuthHeaders();
    expect(headers["Authorization"]).toBe("Bearer secret123");
  });

  it("does not double prefix Bearer", () => {
    process.env.BEARER_TOKEN = "Bearer already";
    const headers = getAuthHeaders();
    expect(headers["Authorization"]).toBe("Bearer already");
  });

  it("returns api key header", () => {
    delete process.env.BEARER_TOKEN;
    delete process.env.API_TOKEN;
    process.env.API_KEY = "key123";
    const headers = getAuthHeaders();
    expect(headers["x-api-key"]).toBe("key123");
  });

  it("supports custom MCP_HEADER_ prefix", () => {
    process.env.MCP_HEADER_X_CUSTOM = "custom-value";
    const headers = getAuthHeaders();
    expect(headers["x-custom"]).toBe("custom-value");
  });

  it("returns empty when no env", () => {
    delete process.env.BEARER_TOKEN;
    delete process.env.API_KEY;
    delete process.env.API_TOKEN;
    delete process.env.MCP_HEADER_X_CUSTOM;
    const headers = getAuthHeaders();
    // may still have BEARER_TOKEN etc undefined; check no auth header
    expect(headers["Authorization"]).toBeUndefined();
  });
});

describe("runtime/executor - build helpers", () => {
  it("extracts path param names", () => {
    expect(extractPathParamNames("/pets/{petId}/photos/{photoId}")).toEqual(["petId", "photoId"]);
    expect(extractPathParamNames("/pets")).toEqual([]);
  });
});

describe("runtime/executor - execute with mocked fetch", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BEARER_TOKEN;
    delete process.env.API_KEY;
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function mockFetch(response: {
    ok: boolean;
    status: number;
    statusText: string;
    body: unknown;
    contentType?: string;
  }) {
    return vi.fn(async () => {
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? (response.contentType ?? "application/json") : null),
        },
        json: async () => response.body,
        text: async () => (typeof response.body === "string" ? response.body : JSON.stringify(response.body)),
      } as unknown as Response;
    });
  }

  it("executes GET with path + query + header mapping", async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, statusText: "OK", body: { id: "123", name: "Fido" } });
    const tool = makeTool();
    const executor = createExecutor(
      {
        baseUrl: "https://api.example.com",
        timeout: 5000,
        retries: 0,
        toolMap: new Map([[tool.name, tool]]),
      },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );

    const result = await executor.execute("listPets", {
      petId: "123",
      limit: 10,
      "X-Request-Id": "uuid-123",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Status: 200 OK");
    expect(result.content[0]?.text).toContain("Fido");

    // Verify fetch called with correct URL and headers
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/pets/123");
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).not.toContain("X-Request-Id"); // header not in query

    const calledOpts = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(calledOpts.headers).toMatchObject({ "X-Request-Id": "uuid-123" });
    expect(calledOpts.method).toBe("GET");
  });

  it("executes POST with JSON body", async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, statusText: "Created", body: { id: "1" } });
    const tool: McpToolDefinition = {
      name: "createPet",
      description: "Create",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Pet name" },
          tag: { type: "string", description: "Tag" },
        },
        required: ["name"],
      },
      _meta: { method: "post", path: "/pets" },
    };

    const executor = createExecutor(
      {
        baseUrl: "https://api.example.com",
        timeout: 5000,
        retries: 0,
        toolMap: new Map([[tool.name, tool]]),
      },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );

    const result = await executor.execute("createPet", { name: "Whiskers", tag: "cat" });
    expect(result.isError).toBeFalsy();
    const opts = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe(JSON.stringify({ name: "Whiskers", tag: "cat" }));
    expect(opts.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("handles HTTP error status gracefully", async () => {
    const fetchMock = mockFetch({ ok: false, status: 404, statusText: "Not Found", body: { error: "not found" } });
    const tool = makeTool();
    const executor = createExecutor(
      { baseUrl: "https://api.example.com", timeout: 5000, retries: 0, toolMap: new Map([[tool.name, tool]]) },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );
    const result = await executor.execute("listPets", { petId: "bad" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("HTTP 404 Not Found");
  });

  it("returns isError for unknown tool", async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, statusText: "OK", body: {} });
    const executor = createExecutor(
      { baseUrl: "https://api.example.com", timeout: 5000, retries: 0, toolMap: new Map() },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );
    const result = await executor.execute("unknown", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Tool not found");
  });

  it("handles timeout with AbortError", async () => {
    const abortFetch = vi.fn(async (_url: string, opts: RequestInit) => {
      // Simulate abort by checking signal
      if (opts.signal) {
        // immediately abort
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      throw new Error("should abort");
    });

    const tool = makeTool();
    const executor = createExecutor(
      { baseUrl: "https://api.example.com", timeout: 10, retries: 0, toolMap: new Map([[tool.name, tool]]) },
      { fetchImpl: abortFetch as unknown as typeof fetch }
    );
    const result = await executor.execute("listPets", { petId: "1" });
    // Our executor wraps timeout via AbortController; mock throws AbortError -> should return isError
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("timed out");
  });

  it("retries on failure with exponential backoff", async () => {
    let calls = 0;
    const flakyFetch = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("network glitch");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      } as unknown as Response;
    });

    const tool = makeTool();
    const executor = createExecutor(
      { baseUrl: "https://api.example.com", timeout: 5000, retries: 1, toolMap: new Map([[tool.name, tool]]) },
      { fetchImpl: flakyFetch as unknown as typeof fetch }
    );
    const result = await executor.execute("listPets", { petId: "1" });
    expect(result.isError).toBeFalsy();
    expect(flakyFetch).toHaveBeenCalledTimes(2);
  });

  it("includes auth headers from env in request", async () => {
    process.env.BEARER_TOKEN = "mytoken";
    const fetchMock = mockFetch({ ok: true, status: 200, statusText: "OK", body: {} });
    const tool = makeTool();
    const executor = createExecutor(
      { baseUrl: "https", timeout: 5000, retries: 0, toolMap: new Map([[tool.name, tool]]) },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );
    // need valid baseUrl for URL construction
    executor.execute = (await import("../src/runtime/executor.js")).createExecutor(
      { baseUrl: "https://api.example.com", timeout: 5000, retries: 0, toolMap: new Map([[tool.name, tool]]) },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    ).execute;

    // directly test via createExecutor with env
    const exec2 = createExecutor(
      { baseUrl: "https://api.example.com", timeout: 5000, retries: 0, toolMap: new Map([[tool.name, tool]]) },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );
    await exec2.execute("listPets", { petId: "1" });
    const opts = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe("Bearer mytoken");
  });
});
