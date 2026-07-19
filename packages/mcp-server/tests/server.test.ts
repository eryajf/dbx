import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { Backend, ConnectionConfig } from "@dbx-app/node-core";
import { createDbxMcpServer, DBX_MCP_PACKAGE_VERSION } from "../src/index.js";

const connection: ConnectionConfig = {
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
};

const backend: Backend = {
  loadMcpGlobalPolicy: async () => ({
    readOnly: false,
    allowDangerousSql: false,
    allowedConnectionIds: null,
    configured: true,
  }),
  loadConnections: async () => [connection],
  findConnection: async (name) => (name === "local" ? connection : undefined),
  addConnection: async () => connection,
  removeConnection: async () => true,
  listTables: async () => [{ name: "users", type: "BASE TABLE" }],
  describeTable: async () => [{ name: "id", data_type: "integer", is_nullable: false, column_default: null, is_primary_key: true, comment: null }],
  executeQuery: async () => ({ columns: ["total"], rows: [{ total: 1 }], row_count: 1 }),
};

async function withScopedEnv<T>(env: Record<string, string>, fn: () => T | Promise<T>): Promise<T> {
  const oldValues = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    oldValues.set(key, process.env[key]);
    process.env[key] = env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of oldValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("creates an MCP server without starting stdio transport", () => {
  const server = createDbxMcpServer(backend, { isWebMode: true });

  assert.equal(typeof server.connect, "function");
});

test("MCP server metadata version matches package metadata", () => {
  const server = createDbxMcpServer(backend, { isWebMode: true });

  assert.equal((server as any).server._serverInfo.version, DBX_MCP_PACKAGE_VERSION);
});

test("README runtime requirements match package engines", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8")) as {
    engines: { node: string };
  };
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf-8");
  const minimumNodeVersion = packageJson.engines.node.replace(">=", "");

  assert.match(readme, new RegExp(`Node\\.js ${minimumNodeVersion.replace(/\./g, "\\.")} or newer`));
  assert.match(readme, new RegExp(`Node\\.js ${minimumNodeVersion.replace(/\./g, "\\.")} 或更高版本`));
});

test("execute query scopes the connection to the requested database", async () => {
  let usedDatabase = "";
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async (config) => {
      usedDatabase = config.database || "";
      return { columns: ["total"], rows: [{ total: 1 }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    database: "stores_demo",
    sql: "SELECT FIRST 1 tabname FROM systables",
  });

  assert.equal(usedDatabase, "stores_demo");
});

test("execute query runs safe multi-statement SQL one statement at a time", async () => {
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: ["value"], rows: [{ value: executed.length }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "select 1; select 2;",
  });

  assert.deepEqual(executed, ["select 1", "select 2"]);
  assert.match(result.content[0].text, /Statement 1/);
  assert.match(result.content[0].text, /Statement 2/);
});

test("multi-statement execution reloads policy before every statement", async () => {
  let readOnly = false;
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly, allowDangerousSql: false, allowedConnectionIds: null }),
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      readOnly = true;
      return { columns: [], rows: [], row_count: 1 };
    },
  };
  const result = await withScopedEnv({ DBX_MCP_ALLOW_WRITES: "1" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_query.handler({
      connection_name: "local",
      sql: "insert into users (id, name) values (1, 'a'); insert into users (id, name) values (2, 'b');",
    });
  });

  assert.deepEqual(executed, ["insert into users (id, name) values (1, 'a')"]);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MCP_READ_ONLY: Statement 2:/);
});

test("execute query preserves string literals and PostgreSQL dollar quotes", async () => {
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: ["value"], rows: [{ value: 1 }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "SELECT 'a;b' AS first; SELECT $tag$c;d$tag$ AS second;",
  });

  assert.deepEqual(executed, ["SELECT 'a;b' AS first", "SELECT $tag$c;d$tag$ AS second"]);
});

test("execute query reports the blocked statement number for unsafe multi-statement SQL", async () => {
  const server = createDbxMcpServer(backend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "select 1; delete from users;",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SQL_BLOCKED:/);
  assert.match(result.content[0].text, /Statement 2/);
  assert.match(result.content[0].text, /High-risk SQL/i);
});

test("high-risk SQL follows the central policy and ignores client environment flags", async () => {
  const executed: string[] = [];
  const safeBackend: Backend = {
    ...backend,
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: [], rows: [], row_count: 0 };
    },
  };

  const blocked = await withScopedEnv({ DBX_MCP_ALLOW_DANGEROUS_SQL: "1" }, () => {
    const server = createDbxMcpServer(safeBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_query.handler({
      connection_name: "local",
      sql: "TRUNCATE TABLE users",
    });
  });

  const dangerousBackend: Backend = {
    ...safeBackend,
    loadMcpGlobalPolicy: async () => ({
      readOnly: false,
      allowDangerousSql: true,
      allowedConnectionIds: null,
    }),
  };
  const allowed = await withScopedEnv({ DBX_MCP_ALLOW_WRITES: "0", DBX_MCP_ALLOW_DANGEROUS_SQL: "0" }, () => {
    const server = createDbxMcpServer(dangerousBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_query.handler({
      connection_name: "local",
      sql: "TRUNCATE TABLE users",
    });
  });

  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /SQL_BLOCKED:/);
  assert.equal(allowed.isError, undefined);
  assert.deepEqual(executed, ["TRUNCATE TABLE users"]);
});

test("persistent database switching remains blocked when high-risk SQL is enabled", async () => {
  let executed = false;
  const dangerousBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({
      readOnly: false,
      allowDangerousSql: true,
      allowedConnectionIds: null,
    }),
    executeQuery: async () => {
      executed = true;
      return { columns: [], rows: [], row_count: 0 };
    },
  };
  const server = createDbxMcpServer(dangerousBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "USE reporting",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SQL_BLOCKED:.*persistent database switching/i);
  assert.equal(executed, false);
});

test("safe-write policy allows row-specific UPDATE and DELETE", async () => {
  const executed: string[] = [];
  const safeBackend: Backend = {
    ...backend,
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: [], rows: [], row_count: 0 };
    },
  };
  const server = createDbxMcpServer(safeBackend, { isWebMode: true });

  for (const sql of ["UPDATE users SET active = 0 WHERE id = 1", "DELETE FROM users WHERE id = 1"]) {
    const result = await (server as any)._registeredTools.dbx_execute_query.handler({ connection_name: "local", sql });
    assert.equal(result.isError, undefined, sql);
  }

  assert.deepEqual(executed, ["UPDATE users SET active = 0 WHERE id = 1", "DELETE FROM users WHERE id = 1"]);
});

test("safe-write policy blocks unbounded UPDATE and DELETE", async () => {
  let executed = false;
  const safeBackend: Backend = {
    ...backend,
    executeQuery: async () => {
      executed = true;
      return { columns: [], rows: [], row_count: 0 };
    },
  };
  const server = createDbxMcpServer(safeBackend, { isWebMode: true });

  for (const sql of [
    "UPDATE users SET active = 0",
    "DELETE FROM users WHERE 1 = 1",
    "UPDATE users SET active = 0 WHERE id = id",
    "DELETE FROM users WHERE id IS NULL OR NOT (id IS NULL)",
    "DELETE FROM users WHERE id = 1 OR id <> 1 OR id IS NULL",
    "DELETE FROM users WHERE LOWER(_utf8mb4'A') = 'a'",
    "DELETE FROM users WHERE id IN (SELECT id FROM archived_users)",
    "SELECT setval('user_id_seq', 42)",
    "SELECT * FROM users FOR UPDATE",
    "COPY users TO '/tmp/users.csv'",
    "INSERT INTO archive TABLE users",
  ]) {
    const result = await (server as any)._registeredTools.dbx_execute_query.handler({ connection_name: "local", sql });
    assert.equal(result.isError, true, sql);
    assert.match(result.content[0].text, /SQL_BLOCKED:/);
  }

  assert.equal(executed, false);
});

test("scoped MCP lists only the active connection", async () => {
  const other: ConnectionConfig = { ...connection, id: "2", name: "other", database: "other_db" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connection, other],
  };

  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_ID: "1" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_connections.handler({});
  });

  assert.match(result.content[0].text, /local/);
  assert.doesNotMatch(result.content[0].text, /other/);
});

test("connections outside the global MCP allowlist are hidden and cannot be resolved by id", async () => {
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: false, allowDangerousSql: false, allowedConnectionIds: [] }),
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const listed = await (server as any)._registeredTools.dbx_list_connections.handler({});
  const resolved = await (server as any)._registeredTools.dbx_list_tables.handler({ connection_id: connection.id });

  assert.match(listed.content[0].text, /No MCP-enabled connections/);
  assert.equal(resolved.isError, true);
  assert.match(resolved.content[0].text, /CONNECTION_OUT_OF_SCOPE:/);
});

test("client scope cannot expose a connection outside the global MCP allowlist", async () => {
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: false, allowDangerousSql: false, allowedConnectionIds: [] }),
  };
  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_ID: connection.id }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_tables.handler({});
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /CONNECTION_OUT_OF_SCOPE:/);
});

test("global MCP read-only policy overrides a writable client environment", async () => {
  let executed = false;
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: true, allowDangerousSql: false, allowedConnectionIds: null }),
    executeQuery: async () => {
      executed = true;
      return { columns: [], rows: [], row_count: 1 };
    },
  };

  const result = await withScopedEnv({ DBX_MCP_ALLOW_WRITES: "1" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_query.handler({
      connection_id: connection.id,
      sql: "insert into users (id, name) values (1, 'x')",
    });
  });

  assert.equal(executed, false);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MCP_READ_ONLY:/);
});

test("connection listing reports the effective central MCP execution mode", async () => {
  const readOnlyServer = createDbxMcpServer({
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: true, allowDangerousSql: true, allowedConnectionIds: null }),
  }, { isWebMode: true });
  const safeWriteServer = createDbxMcpServer(backend, { isWebMode: true });
  const highRiskServer = createDbxMcpServer({
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: false, allowDangerousSql: true, allowedConnectionIds: null }),
  }, { isWebMode: true });

  const readOnly = await (readOnlyServer as any)._registeredTools.dbx_list_connections.handler({});
  const safeWrite = await (safeWriteServer as any)._registeredTools.dbx_list_connections.handler({});
  const highRisk = await (highRiskServer as any)._registeredTools.dbx_list_connections.handler({});

  assert.match(readOnly.content[0].text, /read_only/);
  assert.match(safeWrite.content[0].text, /safe_write/);
  assert.match(highRisk.content[0].text, /high_risk_write/);
});

test("general connection read-only remains authoritative for MCP", async () => {
  let executed = false;
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [{ ...connection, read_only: true }],
    executeQuery: async () => {
      executed = true;
      return { columns: [], rows: [], row_count: 1 };
    },
  };
  const result = await withScopedEnv({ DBX_MCP_ALLOW_WRITES: "1" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_query.handler({
      connection_name: "local",
      sql: "delete from users where id = 1",
    });
  });

  assert.equal(executed, false);
  assert.match(result.content[0].text, /CONNECTION_READ_ONLY:/);
});

test("global MCP read-only blocks MongoDB and Redis writes", async () => {
  let executed = false;
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: true, allowDangerousSql: false, allowedConnectionIds: null }),
    loadConnections: async () => [{ ...connection, db_type: "mongodb" }],
    executeQuery: async () => {
      executed = true;
      return { columns: [], rows: [], row_count: 1 };
    },
    executeRedisCommand: async () => {
      executed = true;
      return { command: "SET", safety: "write", value: "OK" };
    },
  };
  const mongoServer = createDbxMcpServer(scopedBackend, { isWebMode: true });
  const mongo = await (mongoServer as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: 'db.projects.insertOne({"name":"blocked"})',
  });

  scopedBackend.loadConnections = async () => [{ ...connection, db_type: "redis" }];
  const redisServer = createDbxMcpServer(scopedBackend, { isWebMode: true });
  const redis = await (redisServer as any)._registeredTools.dbx_execute_redis_command.handler({
    connection_name: "local",
    command: "SET key value",
  });

  assert.equal(executed, false);
  assert.match(mongo.content[0].text, /MCP_READ_ONLY:/);
  assert.match(redis.content[0].text, /MCP_READ_ONLY:/);
});

test("global MCP read-only blocks Redis module, metadata, and unknown writes", async () => {
  const executed: string[] = [];
  const redisConnection: ConnectionConfig = { ...connection, db_type: "redis" };
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: true, allowDangerousSql: true, allowedConnectionIds: null }),
    loadConnections: async () => [redisConnection],
    executeRedisCommand: async (_config, _db, command) => {
      executed.push(command);
      return { command, safety: "write", value: "OK" };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  for (const command of ["JSON.SET session:1 $ {}", "GETEX session:1 EX 30", "FCALL mutate 0", "XGROUP CREATE jobs workers $", "VENDOR.WRITE key value"]) {
    const result = await (server as any)._registeredTools.dbx_execute_redis_command.handler({
      connection_name: "local",
      command,
    });
    assert.equal(result.isError, true, command);
    assert.match(result.content[0].text, /MCP_READ_ONLY:/, command);
  }

  assert.deepEqual(executed, []);
});

test("production Redis protection blocks writes including centrally approved unknown commands", async () => {
  const executed: string[] = [];
  const redisConnection: ConnectionConfig = { ...connection, db_type: "redis", is_production: true };
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: false, allowDangerousSql: true, allowedConnectionIds: null }),
    loadConnections: async () => [redisConnection],
    executeRedisCommand: async (_config, _db, command) => {
      executed.push(command);
      return { command, safety: "write", value: "OK" };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  for (const command of ["JSON.SET session:1 $ {}", "GETEX session:1 EX 30", "VENDOR.WRITE key value"]) {
    const result = await (server as any)._registeredTools.dbx_execute_redis_command.handler({
      connection_name: "local",
      command,
    });
    assert.equal(result.isError, true, command);
    assert.match(result.content[0].text, /PRODUCTION_WRITE_BLOCKED:/, command);
  }

  assert.deepEqual(executed, []);
});

test("policy load failures fail every MCP tool closed", async () => {
  const unavailableBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => {
      throw new Error("settings database is locked");
    },
  };
  const server = createDbxMcpServer(unavailableBackend, { isWebMode: false });
  const tools = (server as any)._registeredTools;
  const calls: Array<Promise<any>> = [
    tools.dbx_list_connections.handler({}),
    tools.dbx_list_tables.handler({ connection_name: "local" }),
    tools.dbx_describe_table.handler({ connection_name: "local", table: "users" }),
    tools.dbx_execute_query.handler({ connection_name: "local", sql: "select 1" }),
    tools.dbx_execute_redis_command.handler({ connection_name: "local", command: "GET key" }),
    tools.dbx_get_schema_context.handler({ connection_name: "local", max_tables: 1 }),
    tools.dbx_add_connection.handler({ name: "new", db_type: "postgres", host: "localhost", port: 5432, username: "", password: "", ssl: false }),
    tools.dbx_remove_connection.handler({ connection_name: "local" }),
    tools.dbx_open_table.handler({ connection_name: "local", table: "users" }),
    tools.dbx_execute_and_show.handler({ connection_name: "local", sql: "select 1" }),
  ];

  for (const result of await Promise.all(calls)) {
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /MCP_POLICY_UNAVAILABLE:/);
  }
});

test("policy load failures do not duplicate an existing stable error code", async () => {
  const unavailableBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => {
      throw new Error("MCP_POLICY_UNAVAILABLE: settings database is locked");
    },
  };
  const server = createDbxMcpServer(unavailableBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_list_connections.handler({});
  const message = result.content[0].text as string;

  assert.equal(result.isError, true);
  assert.equal(message, "MCP_POLICY_UNAVAILABLE: settings database is locked");
  assert.equal(message.match(/MCP_POLICY_UNAVAILABLE:/g)?.length, 1);
});

test("connection id scope takes precedence over a conflicting name scope", async () => {
  const other: ConnectionConfig = { ...connection, id: "2", name: "other" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connection, other],
  };

  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_ID: "1", DBX_MCP_SCOPE_CONNECTION_NAME: "other" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_connections.handler({});
  });

  assert.match(result.content[0].text, /local/);
  assert.doesNotMatch(result.content[0].text, /other/);
});

test("plural connection scope lists every selected connection and excludes others", async () => {
  const other: ConnectionConfig = { ...connection, id: "2", name: "other" };
  const excluded: ConnectionConfig = { ...connection, id: "3", name: "excluded" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connection, other, excluded],
  };

  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_IDS: "1, 2" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_connections.handler({});
  });

  assert.match(result.content[0].text, /local/);
  assert.match(result.content[0].text, /other/);
  assert.doesNotMatch(result.content[0].text, /excluded/);
});

test("multiple scoped connections require an explicit connection for connection-taking tools", async () => {
  const other: ConnectionConfig = { ...connection, id: "2", name: "other" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connection, other],
  };

  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_IDS: "1,2" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_tables.handler({});
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /CONNECTION_REQUIRED:/);
});

test("multiple scoped connections resolve an explicitly selected connection", async () => {
  const other: ConnectionConfig = { ...connection, id: "2", name: "other" };
  let usedConnectionId = "";
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connection, other],
    listTables: async (config) => {
      usedConnectionId = config.id;
      return [{ name: "users", type: "BASE TABLE" }];
    },
  };

  await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_IDS: "1,2" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_tables.handler({ connection_id: "2" });
  });

  assert.equal(usedConnectionId, "2");
});

test("plural connection scope takes precedence over singular id and name scope", async () => {
  const other: ConnectionConfig = { ...connection, id: "2", name: "other" };
  const excluded: ConnectionConfig = { ...connection, id: "3", name: "excluded" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connection, other, excluded],
  };

  const result = await withScopedEnv(
    {
      DBX_MCP_SCOPE_CONNECTION_IDS: "1,2",
      DBX_MCP_SCOPE_CONNECTION_ID: "3",
      DBX_MCP_SCOPE_CONNECTION_NAME: "excluded",
    },
    () => {
      const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
      return (server as any)._registeredTools.dbx_list_connections.handler({});
    },
  );

  assert.match(result.content[0].text, /local/);
  assert.match(result.content[0].text, /other/);
  assert.doesNotMatch(result.content[0].text, /excluded/);
});

test("global MCP read-only policy disables MCP connection management", async () => {
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: true, allowDangerousSql: false, allowedConnectionIds: null }),
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_remove_connection.handler({
    connection_name: connection.name,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MCP_READ_ONLY:/);
});

test("remove connection cannot delete a target outside the global MCP allowlist", async () => {
  let removed = false;
  const scopedBackend: Backend = {
    ...backend,
    loadMcpGlobalPolicy: async () => ({ readOnly: false, allowDangerousSql: false, allowedConnectionIds: [] }),
    removeConnectionById: async () => {
      removed = true;
      return true;
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
  const result = await (server as any)._registeredTools.dbx_remove_connection.handler({
    connection_name: connection.name,
    connection_id: connection.id,
  });

  assert.equal(removed, false);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /CONNECTION_OUT_OF_SCOPE:/);
});

test("scoped MCP rejects out-of-scope connection tool calls", async () => {
  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_ID: "1" }, () => {
    const server = createDbxMcpServer(backend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_tables.handler({ connection_name: "other" });
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /CONNECTION_OUT_OF_SCOPE:/);
});

test("scoped MCP defaults connection-taking tools to the active connection and database", async () => {
  let usedDatabase = "";
  const scopedBackend: Backend = {
    ...backend,
    listTables: async (config) => {
      usedDatabase = config.database || "";
      return [{ name: "users", type: "BASE TABLE" }];
    },
  };

  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_ID: "1", DBX_MCP_SCOPE_DATABASE: "scoped_db" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_list_tables.handler({});
  });

  assert.match(result.content[0].text, /users/);
  assert.equal(usedDatabase, "scoped_db");
});

test("scoped MCP does not register mutation or desktop bridge tools", async () => {
  await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_ID: "1" }, () => {
    const server = createDbxMcpServer(backend, { isWebMode: false });
    const tools = (server as any)._registeredTools;

    assert.equal(tools.dbx_add_connection, undefined);
    assert.equal(tools.dbx_remove_connection, undefined);
    assert.equal(tools.dbx_open_table, undefined);
    assert.equal(tools.dbx_execute_and_show, undefined);
  });
});

test("scoped MCP ignores client write flags and follows the central policy", async () => {
  let executed = false;
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async () => {
      executed = true;
      return { columns: [], rows: [], row_count: 1 };
    },
  };
  const result = await withScopedEnv({ DBX_MCP_SCOPE_CONNECTION_ID: "1", DBX_MCP_ALLOW_WRITES: "0" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_query.handler({
      sql: "insert into users (id, name) values (1, 'x')",
    });
  });

  assert.equal(result.isError, undefined);
  assert.equal(executed, true);
});

test("redis execute query points callers to the redis command tool", async () => {
  const redisConnection: ConnectionConfig = { ...connection, db_type: "redis", database: "0" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [redisConnection],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "GET session:1",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /REDIS_COMMAND_REQUIRED:/);
  assert.match(result.content[0].text, /dbx_execute_redis_command/);
});

test("redis command tool executes redis commands on the selected database", async () => {
  const redisConnection: ConnectionConfig = { ...connection, db_type: "redis", database: "2" };
  let usedDb = -1;
  let usedCommand = "";
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [redisConnection],
    executeRedisCommand: async (_config, db, command) => {
      usedDb = db;
      usedCommand = command;
      return { command: "GET", safety: "allowed", value: "value-1" };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_redis_command.handler({
    connection_name: "local",
    command: "GET session:1",
  });

  assert.equal(result.isError, undefined);
  assert.equal(usedDb, 2);
  assert.equal(usedCommand, "GET session:1");
  assert.match(result.content[0].text, /Command: GET/);
  assert.match(result.content[0].text, /value-1/);
});

test("dbx_execute_query does not log SQL when debug diagnostics are disabled", async () => {
  const original = console.error;
  const originalDebug = process.env.DBX_SQL_DEBUG;
  const originalMcpDebug = process.env.DBX_MCP_DEBUG_SQL;
  const messages: unknown[][] = [];
  delete process.env.DBX_SQL_DEBUG;
  delete process.env.DBX_MCP_DEBUG_SQL;
  console.error = (...args: unknown[]) => messages.push(args);
  try {
    const server = createDbxMcpServer(backend, { isWebMode: true });
    const result = await (server as any)._registeredTools.dbx_execute_query.handler({
      connection_name: "local",
      sql: "select 'secret-123' as token",
    });
    assert.equal(result.isError, undefined);
  } finally {
    console.error = original;
    if (originalDebug === undefined) delete process.env.DBX_SQL_DEBUG;
    else process.env.DBX_SQL_DEBUG = originalDebug;
    if (originalMcpDebug === undefined) delete process.env.DBX_MCP_DEBUG_SQL;
    else process.env.DBX_MCP_DEBUG_SQL = originalMcpDebug;
  }

  assert.equal(messages.length, 0);
});

test("dbx_execute_query omits raw SQL from user-facing query errors", async () => {
  const sensitiveSql = "select 'secret-123' as token";
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async () => {
      throw new Error("driver rejected statement");
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: sensitiveSql,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /QUERY_ERROR: driver rejected statement/);
  assert.doesNotMatch(result.content[0].text, /secret-123|SQL:/);
});

test("client write environment cannot make a writable central policy read-only", async () => {
  let executed = false;
  const redisConnection: ConnectionConfig = { ...connection, db_type: "redis" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [redisConnection],
    executeRedisCommand: async () => {
      executed = true;
      return { command: "SET", safety: "write", value: "OK" };
    },
  };

  const result = await withScopedEnv({ DBX_MCP_ALLOW_WRITES: "0" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_redis_command.handler({
      connection_name: "local",
      command: "SET session:1 value",
    });
  });

  assert.equal(executed, true);
  assert.equal(result.isError, undefined);
});

test("redis explicit-key deletes are allowed by safe-write policy", async () => {
  const redisConnection: ConnectionConfig = { ...connection, db_type: "redis" };
  let receivedSkipSafetyCheck = true;
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [redisConnection],
    executeRedisCommand: async (_config, _db, _command, options) => {
      receivedSkipSafetyCheck = options?.skipSafetyCheck ?? false;
      return { command: "DEL", safety: "confirm", value: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_redis_command.handler({
    connection_name: "local",
    command: "DEL session:1",
  });

  assert.equal(result.isError, undefined);
  assert.equal(receivedSkipSafetyCheck, false);
});

test("redis high-risk commands follow only the central policy", async () => {
  const redisConnection: ConnectionConfig = { ...connection, db_type: "redis" };
  let skipSafetyCheck = false;
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [redisConnection],
    executeRedisCommand: async (_config, _db, _command, options) => {
      skipSafetyCheck = options?.skipSafetyCheck ?? false;
      return { command: "KEYS", safety: "blocked", value: ["session:1"] };
    },
  };

  const blocked = await withScopedEnv({ DBX_MCP_ALLOW_DANGEROUS_SQL: "1" }, () => {
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_redis_command.handler({
      connection_name: "local",
      command: "KEYS *",
    });
  });
  const dangerousBackend: Backend = {
    ...scopedBackend,
    loadMcpGlobalPolicy: async () => ({
      readOnly: false,
      allowDangerousSql: true,
      allowedConnectionIds: null,
    }),
  };
  const allowed = await withScopedEnv({ DBX_MCP_ALLOW_DANGEROUS_SQL: "0" }, () => {
    const server = createDbxMcpServer(dangerousBackend, { isWebMode: true });
    return (server as any)._registeredTools.dbx_execute_redis_command.handler({
      connection_name: "local",
      command: "KEYS *",
    });
  });

  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /REDIS_COMMAND_BLOCKED:/);
  assert.equal(allowed.isError, undefined);
  assert.equal(skipSafetyCheck, true);
  assert.match(allowed.content[0].text, /session:1/);
});

test("mongodb list tables returns collections from the selected database", async () => {
  let usedDatabase = "";
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb", database: "admin" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mongoConnection],
    listTables: async (config) => {
      usedDatabase = config.database || "";
      return [{ name: "projects", type: "COLLECTION" }];
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_name: "local",
    database: "pystrument",
  });

  assert.equal(usedDatabase, "pystrument");
  assert.match(result.content[0].text, /projects/);
  assert.match(result.content[0].text, /COLLECTION/);
});

test("mongodb describe table returns inferred document fields", async () => {
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mongoConnection],
    describeTable: async () => [
      {
        name: "_id",
        data_type: "object",
        is_nullable: false,
        column_default: null,
        is_primary_key: true,
        comment: null,
      },
      {
        name: "name",
        data_type: "string",
        is_nullable: false,
        column_default: null,
        is_primary_key: false,
        comment: null,
      },
    ],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_describe_table.handler({
    connection_name: "local",
    database: "pystrument",
    table: "projects",
  });

  assert.match(result.content[0].text, /_id \(PK\)/);
  assert.match(result.content[0].text, /name/);
});

test("dameng metadata tools default to the login user schema", async () => {
  const damengConnection: ConnectionConfig = {
    ...connection,
    db_type: "dameng",
    username: "SYSDBA",
    database: "DAMENG",
  };
  const usedScopes: Array<{ database?: string; schema?: string }> = [];
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [damengConnection],
    listTables: async (config, schema) => {
      usedScopes.push({ database: config.database, schema });
      return [{ name: "ORDERS", type: "TABLE" }];
    },
    describeTable: async (config, _table, schema) => {
      usedScopes.push({ database: config.database, schema });
      return [{ name: "ID", data_type: "BIGINT", is_nullable: false, column_default: null, is_primary_key: true, comment: null }];
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  await (server as any)._registeredTools.dbx_list_tables.handler({ connection_name: "local" });
  await (server as any)._registeredTools.dbx_describe_table.handler({ connection_name: "local", table: "ORDERS" });

  assert.deepEqual(usedScopes, [
    { database: "DAMENG", schema: "SYSDBA" },
    { database: "DAMENG", schema: "SYSDBA" },
  ]);
});

test("dameng metadata tools treat database as a schema alias while preferring explicit schema", async () => {
  const damengConnection: ConnectionConfig = { ...connection, db_type: "dameng", username: "SYSDBA", database: "DAMENG" };
  let usedSchema = "";
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [damengConnection],
    listTables: async (_config, schema) => {
      usedSchema = schema || "";
      return [{ name: "ORDERS", type: "TABLE" }];
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  await (server as any)._registeredTools.dbx_list_tables.handler({ connection_name: "local", database: "XC" });

  assert.equal(usedSchema, "XC");

  await (server as any)._registeredTools.dbx_list_tables.handler({ connection_name: "local", database: "XC", schema: "REPORTING" });

  assert.equal(usedSchema, "REPORTING");
});

test("mongodb execute query formats shell-style find results", async () => {
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mongoConnection],
    executeQuery: async () => ({
      columns: ["_id", "meta", "missing"],
      rows: [{ _id: "1", meta: { name: "demo" }, missing: null }],
      row_count: 1,
    }),
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    database: "pystrument",
    sql: "db.projects.find({}).limit(1)",
  });

  assert.match(result.content[0].text, /"name":"demo"/);
  assert.match(result.content[0].text, /NULL/);
  assert.match(result.content[0].text, /1 row\(s\)/);
});

test("mongodb safe-write policy allows filtered updates and blocks unbounded updates", async () => {
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb" };
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mongoConnection],
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: [], rows: [], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const guarded = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: 'db.projects.updateOne({"_id":"1"},{"$set":{"name":"next"}})',
  });
  const unbounded = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: 'db.projects.updateMany({},{"$set":{"name":"next"}})',
  });
  const wrappedComplement = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: 'db.projects.deleteMany({"$or":[{"$and":[{"id":{"$eq":1}}]},{"id":{"$ne":1}}]})',
  });

  assert.equal(guarded.isError, undefined);
  assert.equal(unbounded.isError, true);
  assert.match(unbounded.content[0].text, /SQL_BLOCKED:/);
  assert.equal(wrappedComplement.isError, true);
  assert.match(wrappedComplement.content[0].text, /SQL_BLOCKED:/);
  assert.deepEqual(executed, ['db.projects.updateOne({"_id":"1"},{"$set":{"name":"next"}})']);
});

test("mongodb aggregate writes cannot target a protected production database", async () => {
  const mongoConnection: ConnectionConfig = {
    ...connection,
    db_type: "mongodb",
    database: "staging",
    production_databases: ["production"],
  };
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mongoConnection],
    loadMcpGlobalPolicy: async () => ({ readOnly: false, allowDangerousSql: true, allowedConnectionIds: null }),
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: [], rows: [], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  for (const sql of [
    'db.src.aggregate([{"$out":{"db":"production","coll":"copied"}}])',
    'db.src.aggregate([{"$merge":{"into":{"db":"production","coll":"copied"}}}])',
  ]) {
    const result = await (server as any)._registeredTools.dbx_execute_query.handler({
      connection_name: "local",
      database: "staging",
      sql,
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /PRODUCTION_WRITE_BLOCKED:/);
  }
  assert.deepEqual(executed, []);
});

test("multi-statement SQL cannot switch a pooled session database", async () => {
  const mysqlConnection: ConnectionConfig = {
    ...connection,
    db_type: "mysql",
    database: "staging",
    production_databases: ["production"],
  };
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mysqlConnection],
    loadMcpGlobalPolicy: async () => ({ readOnly: false, allowDangerousSql: true, allowedConnectionIds: null }),
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: [], rows: [], row_count: 0 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    database: "staging",
    sql: "USE production; DELETE FROM users WHERE id = 1",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SQL_BLOCKED:.*persistent database switching/i);
  assert.deepEqual(executed, []);
});

test("connection lookup failures include a stable MCP error code", async () => {
  const server = createDbxMcpServer(backend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_name: "missing",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /CONNECTION_NOT_FOUND:/);
  assert.match(result.content[0].text, /missing/);
});

test("add connection accepts H2 file paths without a port", async () => {
  let added: Omit<ConnectionConfig, "id"> | undefined;
  const scopedBackend: Backend = {
    ...backend,
    addConnection: async (config) => {
      added = config;
      return { id: "h2-file", ...config };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_add_connection.handler({
    name: "h2-local",
    db_type: "h2",
    host: "/data/app.mv.db",
    username: "sa",
    password: "",
  });

  assert.equal(result.isError, undefined);
  assert.equal(added?.db_type, "h2");
  assert.equal(added?.host, "/data/app.mv.db");
  assert.equal(added?.port, 0);
});

test("SQL safety failures include a stable MCP error code", async () => {
  const server = createDbxMcpServer(backend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "drop table users",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SQL_BLOCKED:/);
  assert.match(result.content[0].text, /High-risk SQL/);
});

test("query exceptions include a stable MCP error code", async () => {
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async () => {
      throw new Error("database timeout");
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "select 1",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /QUERY_ERROR: database timeout/);
});

test("backend policy errors keep their stable codes", async () => {
  for (const code of ["CONNECTION_READ_ONLY", "PRODUCTION_DATABASE_READ_ONLY", "SQL_BLOCKED"] as const) {
    const scopedBackend: Backend = {
      ...backend,
      executeQuery: async () => {
        throw new Error(`${code}: rejected at the final execution boundary`);
      },
    };
    const server = createDbxMcpServer(scopedBackend, { isWebMode: true });
    const result = await (server as any)._registeredTools.dbx_execute_query.handler({
      connection_name: "local",
      sql: "select 1",
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(`^${code}:`));
  }
});

test("desktop bridge failures include a stable MCP error code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbx-mcp-home-"));

  try {
    // Use DBX_DATA_DIR (honoured cross-platform) to point bridgePortFilePath()
    // at an empty temp directory so no real bridge is reachable.
    await withScopedEnv({ DBX_DATA_DIR: dir }, async () => {
      const server = createDbxMcpServer(backend, { isWebMode: false });
      const result = await (server as any)._registeredTools.dbx_open_table.handler({
        connection_name: "local",
        table: "users",
      });

      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /DBX_NOT_RUNNING:/);
      assert.match(result.content[0].text, /DBX is not running/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mongodb execute-and-show directs callers to the command-aware MCP tool", async () => {
  const mongoConnection: ConnectionConfig = { ...connection, db_type: "mongodb" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mongoConnection],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: false });

  const result = await (server as any)._registeredTools.dbx_execute_and_show.handler({
    connection_name: "local",
    database: "pystrument",
    sql: 'db.projects.aggregate([{"$out":"projects_dump"}])',
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /UNSUPPORTED_OPERATION:/);
  assert.match(result.content[0].text, /dbx_execute_query/);
});

test("execute-and-show rejects every non-SQL connection family", async () => {
  const nonSqlConnection: ConnectionConfig = { ...connection, db_type: "elasticsearch" };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [nonSqlConnection],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: false });

  const result = await (server as any)._registeredTools.dbx_execute_and_show.handler({
    connection_name: "local",
    sql: "GET /_cluster/health",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /UNSUPPORTED_OPERATION:/);
});

test("connection_id parameter resolves correctly", async () => {
  const connA: ConnectionConfig = { ...connection, id: "a1b2c3", name: "shared-name", db_type: "postgres" };
  const connB: ConnectionConfig = { ...connection, id: "d4e5f6", name: "shared-name", db_type: "redis", host: "redis.local", port: 6379 };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connA, connB],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // Resolve by connection_id should return the correct connection
  const result = await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_id: "d4e5f6",
  });

  assert.match(result.content[0].text, /users/);
});

test("duplicate connection names return AMBIGUOUS_CONNECTION error", async () => {
  const connA: ConnectionConfig = { ...connection, id: "a1b2c3", name: "shared-name", db_type: "postgres", host: "pg.local", port: 5432 };
  const connB: ConnectionConfig = { ...connection, id: "d4e5f6", name: "shared-name", db_type: "redis", host: "redis.local", port: 6379 };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connA, connB],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // Using connection_name with duplicates should return AMBIGUOUS_CONNECTION
  const result = await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_name: "shared-name",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /AMBIGUOUS_CONNECTION:/);
  assert.match(result.content[0].text, /a1b2c3:/);
  assert.match(result.content[0].text, /d4e5f6:/);
  assert.match(result.content[0].text, /postgres @ pg.local:5432/);
  assert.match(result.content[0].text, /redis @ redis.local:6379/);
});

test("connection_id takes priority over connection_name", async () => {
  const connA: ConnectionConfig = { ...connection, id: "a1b2c3", name: "shared-name", db_type: "postgres" };
  const connB: ConnectionConfig = { ...connection, id: "d4e5f6", name: "shared-name", db_type: "mysql", host: "mysql.local", port: 3306 };
  let usedConfig: ConnectionConfig | undefined;
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connA, connB],
    listTables: async (config) => {
      usedConfig = config;
      return [{ name: "users", type: "BASE TABLE" }];
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // Provide both connection_id and connection_name; connection_id should win
  await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_id: "d4e5f6",
    connection_name: "shared-name",
  });

  assert.equal(usedConfig?.id, "d4e5f6");
});

test("dbx_list_connections includes ID column", async () => {
  const server = createDbxMcpServer(backend, { isWebMode: true });
  const result = await (server as any)._registeredTools.dbx_list_connections.handler({});

  // The table header should include the ID column
  assert.match(result.content[0].text, /ID.*Name.*Type.*Host.*Port.*Database/);
  // The connection's ID value "1" should appear in the table
  assert.match(result.content[0].text, /1\s+\|\s+local/);
});

test("same name and db_type with different host/port returns AMBIGUOUS_CONNECTION", async () => {
  const connA: ConnectionConfig = {
    ...connection,
    id: "pg-prod-us",
    name: "my-db",
    db_type: "postgres",
    host: "10.0.1.100",
    port: 5432,
    database: "app",
  };
  const connB: ConnectionConfig = {
    ...connection,
    id: "pg-prod-eu",
    name: "my-db",
    db_type: "postgres",
    host: "10.0.2.200",
    port: 5432,
    database: "app",
  };
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connA, connB],
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // Using connection_name with duplicates (same db_type) should still return AMBIGUOUS_CONNECTION
  const result = await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_name: "my-db",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /AMBIGUOUS_CONNECTION:/);
  assert.match(result.content[0].text, /pg-prod-us: postgres @ 10\.0\.1\.100:5432/);
  assert.match(result.content[0].text, /pg-prod-eu: postgres @ 10\.0\.2\.200:5432/);
});

test("connection_id routes to correct host among same-name same-type connections", async () => {
  const connA: ConnectionConfig = {
    ...connection,
    id: "pg-prod-us",
    name: "my-db",
    db_type: "postgres",
    host: "10.0.1.100",
    port: 5432,
    database: "app",
  };
  const connB: ConnectionConfig = {
    ...connection,
    id: "pg-prod-eu",
    name: "my-db",
    db_type: "postgres",
    host: "10.0.2.200",
    port: 5432,
    database: "app",
  };
  const usedConfigs: ConnectionConfig[] = [];
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connA, connB],
    listTables: async (config) => {
      usedConfigs.push(config);
      return [{ name: "orders", type: "BASE TABLE" }];
    },
    executeQuery: async (config, _sql) => {
      usedConfigs.push(config);
      return { columns: ["cnt"], rows: [{ cnt: 42 }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // Route to US instance via connection_id
  const listResult = await (server as any)._registeredTools.dbx_list_tables.handler({
    connection_id: "pg-prod-us",
  });
  assert.match(listResult.content[0].text, /orders/);
  assert.equal(usedConfigs[0].id, "pg-prod-us");
  assert.equal(usedConfigs[0].host, "10.0.1.100");

  // Route to EU instance via connection_id
  const queryResult = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_id: "pg-prod-eu",
    database: "app",
    sql: "select count(*) as cnt from orders",
  });
  assert.match(queryResult.content[0].text, /42/);
  assert.equal(usedConfigs[1].id, "pg-prod-eu");
  assert.equal(usedConfigs[1].host, "10.0.2.200");
});

test("tool responses are prefixed with connection identity label", async () => {
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [{ ...connection, id: "conn-xyz", name: "orders-db", db_type: "postgres", host: "10.5.5.5", port: 5432 }],
    listTables: async () => [{ name: "orders", type: "BASE TABLE" }],
    executeQuery: async () => ({ columns: ["cnt"], rows: [{ cnt: 7 }], row_count: 1 }),
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const listResult = await (server as any)._registeredTools.dbx_list_tables.handler({ connection_id: "conn-xyz" });
  assert.match(listResult.content[0].text, /^\[orders-db \(conn-xyz\) \[postgres @ 10\.5\.5\.5:5432\]\]/);

  const queryResult = await (server as any)._registeredTools.dbx_execute_query.handler({ connection_id: "conn-xyz", sql: "select count(*) as cnt from orders" });
  assert.match(queryResult.content[0].text, /^\[orders-db \(conn-xyz\) \[postgres @ 10\.5\.5\.5:5432\]\]/);
});

test("dbx_remove_connection with duplicate names returns AMBIGUOUS_CONNECTION", async () => {
  const connA: ConnectionConfig = { ...connection, id: "db-a", name: "staging", db_type: "postgres", host: "pg-a.local" };
  const connB: ConnectionConfig = { ...connection, id: "db-b", name: "staging", db_type: "mysql", host: "mysql-b.local", port: 3306 };
  let removedName: string | undefined;
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connA, connB],
    removeConnection: async (name) => {
      removedName = name;
      return true;
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_remove_connection.handler({
    connection_name: "staging",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /AMBIGUOUS_CONNECTION:/);
  assert.match(result.content[0].text, /db-a: postgres @ pg-a\.local/);
  assert.match(result.content[0].text, /db-b: mysql @ mysql-b\.local/);
  // removeConnection must NOT have been called — no silent deletion
  assert.equal(removedName, undefined);
});

test("dbx_execute_query with connection_id routes correctly on bridge-backed (SSH) connections", async () => {
  const connDirect: ConnectionConfig = { ...connection, id: "pg-direct", name: "shared", db_type: "postgres", host: "direct.local", ssh_enabled: false };
  const connSsh: ConnectionConfig = { ...connection, id: "pg-ssh", name: "shared", db_type: "postgres", host: "private.local", ssh_enabled: true };
  const usedConfigs: ConnectionConfig[] = [];
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [connDirect, connSsh],
    executeQuery: async (config, _sql) => {
      usedConfigs.push(config);
      return { columns: ["result"], rows: [{ result: "ok" }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // connection_name with two same-name connections (one SSH-backed) → AMBIGUOUS_CONNECTION
  const ambigResult = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "shared",
    sql: "select 1",
  });
  assert.equal(ambigResult.isError, true);
  assert.match(ambigResult.content[0].text, /AMBIGUOUS_CONNECTION:/);
  assert.match(ambigResult.content[0].text, /pg-direct/);
  assert.match(ambigResult.content[0].text, /pg-ssh/);

  // connection_id routes to the SSH-backed instance and passes its config through
  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_id: "pg-ssh",
    sql: "select 1",
  });
  assert.equal(result.isError, undefined);
  assert.equal(usedConfigs.length, 1);
  assert.equal(usedConfigs[0].id, "pg-ssh");
  assert.equal(usedConfigs[0].host, "private.local");
  assert.equal(usedConfigs[0].ssh_enabled, true);
});

// --- Dialect-aware `#` comment handling ---

test("dbx_execute_query splits PG `#` operator statements correctly", async () => {
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: ["value"], rows: [{ value: 1 }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // On a postgres connection, `#` is an operator, not a comment.
  // `SELECT 1 # 2; SELECT 3` should produce TWO executeQuery calls.
  await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "SELECT 1 # 2; SELECT 3",
  });

  assert.deepEqual(executed, ["SELECT 1 # 2", "SELECT 3"]);
});

test("dbx_execute_query treats `#` as line comment on MySQL connections", async () => {
  const mysqlConn: ConnectionConfig = { ...connection, id: "mysql-1", name: "mysql-local", db_type: "mysql" };
  const executed: string[] = [];
  const scopedBackend: Backend = {
    ...backend,
    loadConnections: async () => [mysqlConn],
    findConnection: async (name) => (name === "mysql-local" ? mysqlConn : undefined),
    executeQuery: async (_config, sql) => {
      executed.push(sql);
      return { columns: ["value"], rows: [{ value: 1 }], row_count: 1 };
    },
  };
  const server = createDbxMcpServer(scopedBackend, { isWebMode: true });

  // On a mysql connection, `#` IS a line comment.
  // The `;` in `SELECT 1;` splits the first statement. The `# comment\nSELECT 2`
  // is a single statement — the `#` makes everything on that line a comment,
  // and after the newline `SELECT 2` continues (no `;` to split).
  await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "mysql-local",
    sql: "SELECT 1; # comment\nSELECT 2",
  });

  assert.deepEqual(executed, ["SELECT 1", "# comment\nSELECT 2"]);
});

test("dbx_execute_query blocks PG injection through `#` as comment in classification", async () => {
  // `SELECT 1 # 2; DELETE FROM t` on a postgres connection: the `#` is an operator,
  // so classification must see the DELETE and block it as a write in read-only mode.
  const server = createDbxMcpServer(backend, { isWebMode: true });

  const result = await (server as any)._registeredTools.dbx_execute_query.handler({
    connection_name: "local",
    sql: "SELECT 1 # 2; DELETE FROM t",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SQL_BLOCKED:/);
});
