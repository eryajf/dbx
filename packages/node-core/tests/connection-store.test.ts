import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import Database from "better-sqlite3";
import { addConnection, inspectConnectionStore, loadConnections, removeConnectionById } from "../src/connections.js";

function createMutableStore(path: string, settingsJson?: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE connections (id TEXT PRIMARY KEY, config_json TEXT NOT NULL);
    CREATE TABLE connection_secrets (
      connection_id TEXT NOT NULL,
      key TEXT NOT NULL,
      secret TEXT NOT NULL,
      PRIMARY KEY (connection_id, key)
    );
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, settings_json TEXT NOT NULL);
  `);
  if (settingsJson !== undefined) {
    db.prepare("INSERT INTO app_settings (id, settings_json) VALUES (1, ?)").run(settingsJson);
  }
  db.close();
}

const testConnection = {
  name: "local",
  db_type: "mysql",
  host: "127.0.0.1",
  port: 3306,
  username: "root",
  password: "",
  ssl: false,
};

test("connection store diagnostics report rows even when loading fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbx-store-"));
  const path = join(dir, "dbx.db");

  try {
    const db = new Database(path);
    db.exec(`
      CREATE TABLE connections (id TEXT PRIMARY KEY, config_json TEXT NOT NULL);
      CREATE TABLE connection_secrets (connection_id TEXT, key TEXT, secret TEXT);
    `);
    db.prepare("INSERT INTO connections (id, config_json) VALUES (?, ?)").run("broken", "{not json");
    db.close();

    await assert.rejects(() => loadConnections({ path }), /Failed to load DBX connections/);

    const diagnostics = await inspectConnectionStore({ path });
    assert.equal(diagnostics.dbPath, path);
    assert.equal(diagnostics.dbPathExists, true);
    assert.equal(diagnostics.connectionsTableExists, true);
    assert.equal(diagnostics.connectionRowCount, 1);
    assert.equal(diagnostics.loadConnectionsOk, false);
    assert.match(diagnostics.loadConnectionsError ?? "", /Failed to load DBX connections/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing connection store is treated as an empty store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbx-store-"));
  const path = join(dir, "missing.db");

  try {
    assert.deepEqual(await loadConnections({ path }), []);

    const diagnostics = await inspectConnectionStore({ path });
    assert.equal(diagnostics.dbPathExists, false);
    assert.equal(diagnostics.connectionsTableExists, false);
    assert.equal(diagnostics.connectionRowCount, 0);
    assert.equal(diagnostics.loadConnectionsOk, true);
    assert.equal(diagnostics.loadedConnectionCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("desktop MCP connection mutations recheck central read-only inside the SQLite transaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbx-store-"));
  const path = join(dir, "dbx.db");

  try {
    createMutableStore(
      path,
      JSON.stringify({
        mcp_global_policy: { readOnly: true, allowDangerousSql: true, allowedConnectionIds: null },
      }),
    );

    await assert.rejects(() => addConnection(testConnection, { path, mcpRequest: true }), /MCP_READ_ONLY/);
    assert.deepEqual(await loadConnections({ path }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("desktop MCP connection mutations fail closed when the central policy is malformed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbx-store-"));
  const path = join(dir, "dbx.db");

  try {
    createMutableStore(path, JSON.stringify({ mcp_global_policy: { readOnly: "no", allowedConnectionIds: null } }));

    await assert.rejects(() => addConnection(testConnection, { path, mcpRequest: true }), /MCP_POLICY_UNAVAILABLE/);
    assert.deepEqual(await loadConnections({ path }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("desktop MCP connection mutations allow unconfigured policy and enforce later policy changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbx-store-"));
  const path = join(dir, "dbx.db");

  try {
    createMutableStore(path);
    const added = await addConnection(testConnection, { path, mcpRequest: true });
    assert.equal((await loadConnections({ path }))[0]?.id, added.id);

    const db = new Database(path);
    db.prepare("INSERT INTO app_settings (id, settings_json) VALUES (1, ?)").run(
      JSON.stringify({
        mcp_global_policy: { readOnly: true, allowDangerousSql: false, allowedConnectionIds: null },
      }),
    );
    db.close();

    await assert.rejects(() => removeConnectionById(added.id, { path, mcpRequest: true }), /MCP_READ_ONLY/);
    assert.equal((await loadConnections({ path }))[0]?.id, added.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("desktop MCP connection removal rechecks the latest allowlist inside the SQLite transaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dbx-store-"));
  const path = join(dir, "dbx.db");

  try {
    createMutableStore(path);
    const added = await addConnection(testConnection, { path, mcpRequest: true });

    const db = new Database(path);
    db.prepare("INSERT INTO app_settings (id, settings_json) VALUES (1, ?)").run(
      JSON.stringify({
        mcp_global_policy: { readOnly: false, allowDangerousSql: false, allowedConnectionIds: [] },
      }),
    );
    db.close();

    await assert.rejects(
      () => removeConnectionById(added.id, { path, mcpRequest: true }),
      /CONNECTION_OUT_OF_SCOPE/,
    );
    assert.equal((await loadConnections({ path }))[0]?.id, added.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
