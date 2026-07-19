import { addConnection as desktopAddConnection, findConnection as desktopFindConnection, loadConnections as desktopLoadConnections, removeConnection as desktopRemoveConnection, removeConnectionById as desktopRemoveConnectionById } from "./connections.js";
import { closeDatabaseResources as desktopCloseDatabaseResources, describeTable as desktopDescribeTable, executeQuery as desktopExecuteQuery, executeRedisCommand as desktopExecuteRedisCommand, listTables as desktopListTables } from "./database.js";
import type { ConnectionConfig } from "./connections.js";
import type { ColumnInfo, QueryOptions, QueryResult, TableInfo } from "./database.js";
import type { RedisCommandOptions, RedisCommandResult } from "./redis-command.js";
import { loadMcpGlobalPolicy as desktopLoadMcpGlobalPolicy, type McpGlobalPolicy } from "./mcp-policy.js";

export interface Backend {
  loadMcpGlobalPolicy(): Promise<McpGlobalPolicy>;
  loadConnections(): Promise<ConnectionConfig[]>;
  findConnection(name: string): Promise<ConnectionConfig | undefined>;
  addConnection(config: Omit<ConnectionConfig, "id">, options?: BackendMutationOptions): Promise<ConnectionConfig>;
  removeConnection(name: string, options?: BackendMutationOptions): Promise<boolean>;
  removeConnectionById?(id: string, options?: BackendMutationOptions): Promise<boolean>;
  listTables(config: ConnectionConfig, schema?: string): Promise<TableInfo[]>;
  describeTable(config: ConnectionConfig, table: string, schema?: string): Promise<ColumnInfo[]>;
  executeQuery(config: ConnectionConfig, sql: string, options?: QueryOptions): Promise<QueryResult>;
  executeRedisCommand?(config: ConnectionConfig, db: number, command: string, options?: RedisCommandOptions): Promise<RedisCommandResult>;
  close?(): Promise<void>;
}

export interface BackendMutationOptions {
  mcpRequest?: boolean;
}

export async function createBackend(env: NodeJS.ProcessEnv = process.env): Promise<Backend> {
  if (env.DBX_WEB_URL) {
    return await import("./web-backend.js");
  }

  return {
    loadMcpGlobalPolicy: desktopLoadMcpGlobalPolicy,
    loadConnections: desktopLoadConnections,
    findConnection: desktopFindConnection,
    addConnection: desktopAddConnection,
    removeConnection: desktopRemoveConnection,
    removeConnectionById: desktopRemoveConnectionById,
    listTables: desktopListTables,
    describeTable: desktopDescribeTable,
    executeQuery: desktopExecuteQuery,
    executeRedisCommand: desktopExecuteRedisCommand,
    close: desktopCloseDatabaseResources,
  };
}
