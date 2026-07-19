import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  addConnection,
  executeQuery,
  executeRedisCommand,
  loadConnections,
  loadMcpGlobalPolicy,
  removeConnection,
  removeConnectionById,
  resetWebAuthForTests,
} from "../src/web-backend.js";

const originalFetch = globalThis.fetch;
const originalWebUrl = process.env.DBX_WEB_URL;
const originalWebPassword = process.env.DBX_WEB_PASSWORD;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWebUrl === undefined) delete process.env.DBX_WEB_URL;
  else process.env.DBX_WEB_URL = originalWebUrl;
  if (originalWebPassword === undefined) delete process.env.DBX_WEB_PASSWORD;
  else process.env.DBX_WEB_PASSWORD = originalWebPassword;
  resetWebAuthForTests();
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
}

test("web backend rejects protected DBX Web access without DBX_WEB_PASSWORD", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  delete process.env.DBX_WEB_PASSWORD;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/auth/check")) {
      return jsonResponse({ authenticated: false, required: true, setup_required: false });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  await assert.rejects(loadConnections(), /DBX_WEB_PASSWORD/);
  assert.deepEqual(calls, ["http://127.0.0.1:4224/api/auth/check"]);
});

test("web backend rejects DBX Web access before password setup is complete", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  delete process.env.DBX_WEB_PASSWORD;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/auth/check")) {
      return jsonResponse({ authenticated: false, required: false, setup_required: true });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  await assert.rejects(loadConnections(), /password setup is required/);
  assert.deepEqual(calls, ["http://127.0.0.1:4224/api/auth/check"]);
});

test("web backend logs in with DBX_WEB_PASSWORD and sends the session cookie", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224/";
  process.env.DBX_WEB_PASSWORD = "secret";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/auth/check")) {
      return jsonResponse({ authenticated: false, required: true, setup_required: false });
    }
    if (url.endsWith("/api/auth/login")) {
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({ password: "secret" }));
      return jsonResponse({ ok: true }, { headers: { "set-cookie": "dbx_session=session-1; Path=/; HttpOnly" } });
    }
    if (url.endsWith("/api/connection/list")) {
      assert.equal((init?.headers as Record<string, string>).Cookie, "dbx_session=session-1");
      return jsonResponse([
        {
          id: "1",
          name: "local",
          db_type: "postgres",
          host: "127.0.0.1",
          port: 5432,
          username: "app",
          password: "",
          database: "demo",
          ssh_enabled: false,
          ssl: false,
        },
      ]);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  const connections = await loadConnections();

  assert.equal(connections[0]?.name, "local");
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "http://127.0.0.1:4224/api/auth/check",
      "http://127.0.0.1:4224/api/auth/login",
      "http://127.0.0.1:4224/api/connection/list",
    ],
  );
});

test("web backend still allows DBX Web instances with password auth disabled", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  delete process.env.DBX_WEB_PASSWORD;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/auth/check")) {
      return jsonResponse({ authenticated: true, required: false, setup_required: false });
    }
    if (url.endsWith("/api/connection/list")) {
      assert.equal((init?.headers as Record<string, string>).Cookie, undefined);
      return jsonResponse([]);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  assert.deepEqual(await loadConnections(), []);
});

test("web backend loads the authenticated MCP global policy API", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/api/auth/check")) return jsonResponse({ authenticated: true, required: false, setup_required: false });
    if (url.endsWith("/api/app-settings/mcp-policy")) {
      return jsonResponse({ readOnly: true, allowDangerousSql: false, allowedConnectionIds: ["1"], configured: true });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  assert.deepEqual(await loadMcpGlobalPolicy(), {
    readOnly: true,
    allowDangerousSql: false,
    allowedConnectionIds: ["1"],
    configured: true,
  });
});

test("web backend adds an MCP connection through the atomic single-connection API", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  let requestConfig: unknown;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/auth/check")) return jsonResponse({ authenticated: true, required: false, setup_required: false });
    if (url.endsWith("/api/connection/mcp/add")) {
      assert.equal(init?.method, "POST");
      requestConfig = (JSON.parse(String(init?.body)) as { config: unknown }).config;
      return jsonResponse(requestConfig);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  const added = await addConnection({
    name: "added", db_type: "mysql", host: "localhost", port: 3306,
    username: "root", password: "", database: "app", ssl: false,
  }, { mcpRequest: true });

  assert.match(added.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(requestConfig, added);
});

test("web backend removes MCP connections by name or id through the atomic target API", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  const connections = [
    { id: "one", name: "Primary", db_type: "postgres", host: "db-1", port: 5432, username: "", password: "", database: "", ssl: false },
    { id: "two", name: "Replica", db_type: "postgres", host: "db-2", port: 5432, username: "", password: "", database: "", ssl: false },
    { id: "three", name: "Archive", db_type: "postgres", host: "db-3", port: 5432, username: "", password: "", database: "", ssl: false },
  ];
  const removedIds: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/auth/check")) return jsonResponse({ authenticated: true, required: false, setup_required: false });
    if (url.endsWith("/api/connection/list")) return jsonResponse(connections);
    if (url.endsWith("/api/connection/mcp/remove")) {
      assert.equal(init?.method, "POST");
      removedIds.push((JSON.parse(String(init?.body)) as { connectionId: string }).connectionId);
      return jsonResponse(true);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  assert.equal(await removeConnection("replica", { mcpRequest: true }), true);
  assert.equal(await removeConnectionById("one", { mcpRequest: true }), true);
  assert.deepEqual(removedIds, ["two", "one"]);
});

test("web backend marks MCP SQL and Redis execution requests for server-side policy enforcement", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  const markedPaths: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/auth/check")) return jsonResponse({ authenticated: true, required: false, setup_required: false });
    if (url.endsWith("/api/connection/connect")) return jsonResponse({ ok: true });
    if (url.endsWith("/api/query/execute")) {
      assert.equal((init?.headers as Record<string, string>)["X-DBX-MCP-Request"], "1");
      markedPaths.push("query");
      return jsonResponse({ columns: ["value"], rows: [[1]] });
    }
    if (url.endsWith("/api/redis/execute-command")) {
      assert.equal((init?.headers as Record<string, string>)["X-DBX-MCP-Request"], "1");
      markedPaths.push("redis");
      return jsonResponse({ command: "GET", safety: "allowed", value: "ok" });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  const sqlConfig = {
    id: "1", name: "sql", db_type: "postgres", host: "127.0.0.1", port: 5432,
    username: "", password: "", database: "demo", ssl: false,
  };
  await executeQuery(sqlConfig, "select 1", { safety: { allowWrites: false } });
  await executeRedisCommand({ ...sqlConfig, name: "redis", db_type: "redis", port: 6379 }, 0, "GET key", { mcpRequest: true });

  assert.deepEqual(markedPaths, ["query", "redis"]);
});

test("web backend routes MongoDB count commands through count-documents", async () => {
  process.env.DBX_WEB_URL = "http://127.0.0.1:4224";
  delete process.env.DBX_WEB_PASSWORD;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/auth/check")) {
      return jsonResponse({ authenticated: true, required: false, setup_required: false });
    }
    if (url.endsWith("/api/connection/connect")) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith("/api/mongo/count-documents")) {
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>)["X-DBX-MCP-Request"], "1");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        connectionId: "mongo-web",
        database: "app",
        collection: "projects",
        filter: '{"active":true}',
        mode: "accurate",
      });
      return jsonResponse(42);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  const result = await executeQuery(
    {
      id: "mongo-web",
      name: "mongo-web",
      db_type: "mongodb",
      host: "127.0.0.1",
      port: 27017,
      username: "",
      password: "",
      database: "app",
      ssh_enabled: false,
      ssl: false,
    },
    'db.projects.countDocuments({"active":true})',
    { safety: { allowWrites: false } },
  );

  assert.deepEqual(result, {
    columns: ["count"],
    rows: [{ count: 42 }],
    row_count: 1,
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "http://127.0.0.1:4224/api/auth/check",
      "http://127.0.0.1:4224/api/connection/connect",
      "http://127.0.0.1:4224/api/mongo/count-documents",
    ],
  );
});
