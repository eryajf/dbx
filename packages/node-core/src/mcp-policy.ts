import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { ConnectionConfig } from "./connections.js";
import { dbPath as defaultDbPath } from "./paths.js";
import type { SqlSafetyOptions } from "./sql-safety.js";

export interface McpGlobalPolicy {
  readOnly: boolean;
  allowDangerousSql: boolean;
  allowedConnectionIds: string[] | null;
  configured?: boolean;
}

export interface McpGlobalPolicyStoreOptions {
  path?: string;
}

export const DEFAULT_MCP_GLOBAL_POLICY: Readonly<McpGlobalPolicy> = Object.freeze({
  readOnly: false,
  allowDangerousSql: false,
  allowedConnectionIds: null,
  configured: false,
});

export class McpPolicyUnavailableError extends Error {
  readonly code = "MCP_POLICY_UNAVAILABLE";

  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`MCP global policy is unavailable: ${message}`);
    this.name = "McpPolicyUnavailableError";
  }
}

function parseMcpGlobalPolicy(value: unknown): McpGlobalPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("mcp_global_policy must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.readOnly !== "boolean") {
    throw new Error("mcp_global_policy.readOnly must be a boolean");
  }
  if (record.allowDangerousSql !== undefined && typeof record.allowDangerousSql !== "boolean") {
    throw new Error("mcp_global_policy.allowDangerousSql must be a boolean when present");
  }
  if (record.allowedConnectionIds !== null && !Array.isArray(record.allowedConnectionIds)) {
    throw new Error("mcp_global_policy.allowedConnectionIds must be an array or null");
  }
  const allowedConnectionIds = record.allowedConnectionIds === null
    ? null
    : [...new Set(record.allowedConnectionIds.map((id) => {
        if (typeof id !== "string" || !id.trim()) {
          throw new Error("mcp_global_policy.allowedConnectionIds must contain non-empty strings");
        }
        return id.trim();
      }))];
  if (record.configured !== undefined && typeof record.configured !== "boolean") {
    throw new Error("mcp_global_policy.configured must be a boolean when present");
  }
  return {
    readOnly: record.readOnly,
    allowDangerousSql: record.allowDangerousSql === true,
    allowedConnectionIds,
    configured: record.configured ?? true,
  };
}

export function normalizeMcpGlobalPolicy(value: unknown): McpGlobalPolicy {
  try {
    return parseMcpGlobalPolicy(value);
  } catch (error) {
    throw error instanceof McpPolicyUnavailableError ? error : new McpPolicyUnavailableError(error);
  }
}

export async function loadMcpGlobalPolicy(options: McpGlobalPolicyStoreOptions = {}): Promise<McpGlobalPolicy> {
  const path = options.path ?? defaultDbPath();
  if (!existsSync(path)) return { ...DEFAULT_MCP_GLOBAL_POLICY };

  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").get();
    if (!table) return { ...DEFAULT_MCP_GLOBAL_POLICY };
    const row = db.prepare("SELECT settings_json FROM app_settings WHERE id = 1").get() as { settings_json: string } | undefined;
    if (!row) return { ...DEFAULT_MCP_GLOBAL_POLICY };
    const settings = JSON.parse(row.settings_json) as unknown;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("app_settings.settings_json must be an object");
    }
    const policy = (settings as Record<string, unknown>).mcp_global_policy;
    if (policy === undefined) return { ...DEFAULT_MCP_GLOBAL_POLICY };
    return parseMcpGlobalPolicy(policy);
  } catch (error) {
    throw new McpPolicyUnavailableError(error);
  } finally {
    db?.close();
  }
}

export function isConnectionAllowedByMcpPolicy(config: ConnectionConfig, policy: McpGlobalPolicy): boolean {
  return policy.allowedConnectionIds === null || policy.allowedConnectionIds.includes(config.id);
}

export function isMcpReadOnly(config: ConnectionConfig, policy: McpGlobalPolicy): boolean {
  return policy.readOnly || config.read_only === true;
}

export function clampConnectionSqlSafety(config: ConnectionConfig, requested: SqlSafetyOptions): SqlSafetyOptions {
  if (config.read_only !== true) return requested;
  return { ...requested, allowWrites: false, allowDangerous: false };
}

export function effectiveMcpSqlSafety(config: ConnectionConfig, policy: McpGlobalPolicy): SqlSafetyOptions {
  const allowWrites = !isMcpReadOnly(config, policy);
  return {
    allowWrites,
    allowDangerous: allowWrites && policy.allowDangerousSql,
  };
}

export function mcpReadOnlyReason(config: ConnectionConfig, policy: McpGlobalPolicy): string {
  if (policy.readOnly) {
    return "DBX global MCP read-only mode is enabled. MCP client configuration cannot override it.";
  }
  return `Connection "${config.name}" has DBX read-only mode enabled. MCP client configuration cannot override it.`;
}

export function connectionReadOnlyReason(config: ConnectionConfig): string {
  return `Connection "${config.name}" has DBX read-only mode enabled.`;
}
