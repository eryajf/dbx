import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "vitest";
import type { ConnectionConfig } from "../src/connections.js";
import {
  effectiveMcpSqlSafety,
  isConnectionAllowedByMcpPolicy,
  isMcpReadOnly,
  loadMcpGlobalPolicy,
  McpPolicyUnavailableError,
  normalizeMcpGlobalPolicy,
} from "../src/mcp-policy.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

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

async function policyDatabase(settings: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dbx-mcp-policy-"));
  tempDirectories.push(directory);
  const path = join(directory, "dbx.db");
  const db = new Database(path);
  db.exec("CREATE TABLE app_settings (id INTEGER PRIMARY KEY, settings_json TEXT NOT NULL)");
  db.prepare("INSERT INTO app_settings (id, settings_json) VALUES (1, ?)").run(JSON.stringify(settings));
  db.close();
  return path;
}

test("missing database defaults to unconfigured read-write access for all connections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dbx-mcp-policy-missing-"));
  tempDirectories.push(directory);
  const policy = await loadMcpGlobalPolicy({ path: join(directory, "missing.db") });

  assert.deepEqual(policy, {
    readOnly: false,
    allowDangerousSql: false,
    allowedConnectionIds: null,
    configured: false,
  });
});

test("loads the atomic MCP policy from app_settings", async () => {
  const path = await policyDatabase({
    theme: "dark",
    mcp_global_policy: { readOnly: true, allowedConnectionIds: ["connection-1", " connection-2 "] },
  });

  assert.deepEqual(await loadMcpGlobalPolicy({ path }), {
    readOnly: true,
    allowDangerousSql: false,
    allowedConnectionIds: ["connection-1", "connection-2"],
    configured: true,
  });
});

test("malformed persisted policy fails closed with MCP_POLICY_UNAVAILABLE", async () => {
  const path = await policyDatabase({ mcp_global_policy: { readOnly: "yes", allowedConnectionIds: null } });

  await assert.rejects(loadMcpGlobalPolicy({ path }), (error: unknown) => {
    assert.ok(error instanceof McpPolicyUnavailableError);
    assert.equal(error.code, "MCP_POLICY_UNAVAILABLE");
    return true;
  });
});

test("global and connection read-only policies cannot be relaxed", () => {
  const globalReadOnly = normalizeMcpGlobalPolicy({ readOnly: true, allowedConnectionIds: null });
  const connectionReadOnly = normalizeMcpGlobalPolicy({ readOnly: false, allowedConnectionIds: null });

  assert.deepEqual(effectiveMcpSqlSafety(connection(), globalReadOnly), { allowWrites: false, allowDangerous: false });
  assert.deepEqual(effectiveMcpSqlSafety(connection({ read_only: true }), connectionReadOnly), { allowWrites: false, allowDangerous: false });
  assert.equal(isMcpReadOnly(connection(), globalReadOnly), true);
});

test("central policy is the only source of MCP write and dangerous permissions", () => {
  const safePolicy = normalizeMcpGlobalPolicy({ readOnly: false, allowDangerousSql: false, allowedConnectionIds: null });
  const dangerousPolicy = normalizeMcpGlobalPolicy({ readOnly: false, allowDangerousSql: true, allowedConnectionIds: null });

  assert.deepEqual(effectiveMcpSqlSafety(connection(), safePolicy), { allowWrites: true, allowDangerous: false });
  assert.deepEqual(effectiveMcpSqlSafety(connection(), dangerousPolicy), { allowWrites: true, allowDangerous: true });
});

test("allowlist distinguishes all, selected, and disabled-all policies", () => {
  const config = connection();

  assert.equal(isConnectionAllowedByMcpPolicy(config, { readOnly: false, allowDangerousSql: false, allowedConnectionIds: null }), true);
  assert.equal(isConnectionAllowedByMcpPolicy(config, { readOnly: false, allowDangerousSql: false, allowedConnectionIds: [config.id] }), true);
  assert.equal(isConnectionAllowedByMcpPolicy(config, { readOnly: false, allowDangerousSql: false, allowedConnectionIds: [] }), false);
});
