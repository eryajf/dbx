import type { ConnectionConfig } from "./connections.js";
import { sqlSafetyFromEnv, type SqlSafetyOptions } from "./sql-safety.js";

export type McpAccessMode = "disabled" | "read_only" | "read_write";

export function mcpAccessMode(config: ConnectionConfig): McpAccessMode {
  const mode = config.mcp_access;
  return mode === "disabled" || mode === "read_only" ? mode : "read_write";
}

export function isMcpConnectionEnabled(config: ConnectionConfig): boolean {
  return mcpAccessMode(config) !== "disabled";
}

export function isMcpConnectionReadOnly(config: ConnectionConfig): boolean {
  return config.read_only === true || mcpAccessMode(config) === "read_only";
}

export function isConnectionReadOnly(config: ConnectionConfig): boolean {
  return config.read_only === true;
}

export function hasManagedMcpPolicy(config: ConnectionConfig): boolean {
  return config.read_only === true || mcpAccessMode(config) !== "read_write";
}

export function clampMcpSqlSafety(config: ConnectionConfig, requested: SqlSafetyOptions): SqlSafetyOptions {
  if (!isMcpConnectionReadOnly(config)) return requested;
  return {
    ...requested,
    allowWrites: false,
    allowDangerous: false,
  };
}

export function clampConnectionSqlSafety(config: ConnectionConfig, requested: SqlSafetyOptions): SqlSafetyOptions {
  if (!isConnectionReadOnly(config)) return requested;
  return {
    ...requested,
    allowWrites: false,
    allowDangerous: false,
  };
}

/**
 * DBX connection policy is authoritative. Environment variables may tighten a
 * session, but they must never make a DBX-managed read-only connection writable.
 */
export function effectiveMcpSqlSafety(config: ConnectionConfig, env: NodeJS.ProcessEnv = process.env): SqlSafetyOptions {
  return clampMcpSqlSafety(config, sqlSafetyFromEnv(env));
}

export function mcpReadOnlyReason(config: ConnectionConfig): string {
  if (config.read_only) {
    return `Connection "${config.name}" has DBX read-only mode enabled. MCP client configuration cannot override it.`;
  }
  return `Connection "${config.name}" has read-only MCP access. Change its MCP access policy in DBX to allow writes.`;
}

export function connectionReadOnlyReason(config: ConnectionConfig): string {
  return `Connection "${config.name}" has DBX read-only mode enabled.`;
}
