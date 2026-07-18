import assert from "node:assert/strict";
import { test } from "vitest";
import type { ConnectionConfig } from "../src/connections.js";
import {
  effectiveMcpSqlSafety,
  hasManagedMcpPolicy,
  isMcpConnectionEnabled,
  isMcpConnectionReadOnly,
  mcpAccessMode,
} from "../src/mcp-policy.js";

const connection = (overrides: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: "connection-1",
  name: "local",
  db_type: "postgres",
  host: "127.0.0.1",
  port: 5432,
  username: "app",
  password: "",
  database: "demo",
  ssl: false,
  ...overrides,
});

test("legacy connections default to read-write MCP access", () => {
  const config = connection();

  assert.equal(mcpAccessMode(config), "read_write");
  assert.equal(isMcpConnectionEnabled(config), true);
  assert.equal(isMcpConnectionReadOnly(config), false);
  assert.equal(hasManagedMcpPolicy(config), false);
});

test("connection MCP policy cannot be relaxed by environment variables", () => {
  const config = connection({ mcp_access: "read_only" });
  const safety = effectiveMcpSqlSafety(config, {
    DBX_MCP_ALLOW_WRITES: "1",
    DBX_MCP_ALLOW_DANGEROUS_SQL: "1",
  });

  assert.equal(safety.allowWrites, false);
  assert.equal(safety.allowDangerous, false);
  assert.equal(hasManagedMcpPolicy(config), true);
});

test("general DBX read-only mode is also authoritative for MCP", () => {
  const config = connection({ read_only: true, mcp_access: "read_write" });
  const safety = effectiveMcpSqlSafety(config, { DBX_MCP_ALLOW_WRITES: "1" });

  assert.equal(isMcpConnectionReadOnly(config), true);
  assert.equal(safety.allowWrites, false);
});

test("disabled connections are not MCP-enabled", () => {
  const config = connection({ mcp_access: "disabled" });

  assert.equal(isMcpConnectionEnabled(config), false);
  assert.equal(hasManagedMcpPolicy(config), true);
});
