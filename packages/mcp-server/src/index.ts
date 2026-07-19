#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { z } from "zod";
import {
  buildSchemaContext,
  classifySqlRisk,
  createBackend,
  evaluateMongoAggregateSafety,
  evaluateMongoWriteSafety,
  evaluateRedisCommandSafety,
  evaluateSqlSafety,
  effectiveMcpSqlSafety,
  formatCell,
  formatSchemaContext,
  isConnectionAllowedByMcpPolicy,
  isMcpReadOnly,
  isSqlRiskMutation,
  isMainModule,
  mcpReadOnlyReason,
  mdTable,
  notifyReload,
  parseMongoAggregateCommand,
  parseMongoWriteCommand,
  assessProductionSql,
  isLikelyMongoMutation,
  mongoAggregateWriteStage,
  mongoAggregateTargetsProductionDatabase,
  isProductionDatabase,
  postBridge,
  logSqlDiagnostic,
  splitSqlStatements,
  supportsHashLineComments,
  supportsSqlQuery,
  type Backend,
  type ConnectionConfig,
  type McpGlobalPolicy,
  type QueryResult,
  type RedisCommandResult,
} from "@dbx-app/node-core";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: string };
export const DBX_MCP_PACKAGE_VERSION = packageJson.version ?? "0.0.0";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function toolError(code: string, message: string) {
  return { ...text(`${code}: ${message}`), isError: true };
}

const BACKEND_POLICY_ERROR_CODES = [
  "MCP_POLICY_UNAVAILABLE",
  "MCP_READ_ONLY",
  "CONNECTION_OUT_OF_SCOPE",
  "CONNECTION_READ_ONLY",
  "PRODUCTION_DATABASE_READ_ONLY",
  "PRODUCTION_WRITE_BLOCKED",
  "SQL_BLOCKED",
  "REDIS_COMMAND_BLOCKED",
] as const;

function backendPolicyToolError(message: string): ReturnType<typeof toolError> | undefined {
  const code = BACKEND_POLICY_ERROR_CODES.find((candidate) => message.includes(`${candidate}:`));
  if (!code) return undefined;
  const marker = `${code}:`;
  return toolError(code, message.slice(message.indexOf(marker) + marker.length).trim());
}

function withDatabase(config: ConnectionConfig, database?: string): ConnectionConfig {
  return database === undefined ? config : { ...config, database };
}

function metadataScope(config: ConnectionConfig, database?: string, schema?: string): { config: ConnectionConfig; schema?: string } {
  if (config.db_type !== "dameng") {
    return { config: withDatabase(config, database), schema };
  }

  // Dameng exposes tables under user-owned schemas rather than separate
  // databases. Accept the legacy database argument as a schema, and default to
  // the login user when neither argument is provided.
  const resolvedSchema = schema?.trim() || database?.trim() || config.username?.trim() || undefined;
  return { config, schema: resolvedSchema };
}

function connectionIdentity(config: ConnectionConfig): string {
  return `${config.name} (${config.id}) [${config.db_type} @ ${config.host}:${config.port}]`;
}

function labeledText(config: ConnectionConfig, body: string): ReturnType<typeof text> {
  return text(`[${connectionIdentity(config)}]\n${body}`);
}

function formatQueryToolResult(result: QueryResult, title?: string) {
  const prefix = title ? `${title}\n` : "";
  if (result.columns.length === 0) return text(`${prefix}Query executed. ${result.row_count} row(s) affected.`);
  const rows = result.rows.map((r) => result.columns.map((c) => formatCell(r[c])));
  return text(`${prefix}${mdTable(result.columns, rows)}\n\n${result.row_count} row(s)`);
}

function redisDbFromValue(value?: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const db = Number(trimmed);
  return Number.isInteger(db) && db >= 0 ? db : undefined;
}

function defaultRedisDb(config: ConnectionConfig, scope: McpScope, db?: number): number {
  return db ?? redisDbFromValue(scope.database) ?? redisDbFromValue(config.database) ?? 0;
}

function formatRedisCommandValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function formatRedisCommandToolResult(result: RedisCommandResult) {
  return text(`Command: ${result.command}\nSafety: ${result.safety}\n\n${formatRedisCommandValue(result.value)}`);
}

export const DBX_CONNECTION_TYPE_DESCRIPTION =
  "Database type: postgres, mysql, sqlite, rqlite, cloudflare-d1, redis, duckdb, clickhouse, sqlserver, mongodb, oracle, elasticsearch, etcd, doris, starrocks, manticoresearch, milvus, qdrant, weaviate, chromadb, redshift, dameng, kingbase, highgo, vastbase, goldendb, databend, gaussdb, kwdb, yashandb, databricks, saphana, teradata, vertica, firebird, exasol, opengauss, oceanbase-oracle, questdb, gbase, h2, snowflake, trino, prestosql, hive, spark, db2, informix, influxdb, iris, neo4j, cassandra, bigquery, kylin, sundb, oscar, tdengine, iotdb, xugu, zookeeper, jdbc, access, mq";
const FILE_CAPABLE_CONNECTION_TYPES = new Set(["sqlite", "duckdb", "access", "h2"]);

interface McpScope {
  connectionIds: string[];
  connectionName?: string;
  database?: string;
}

function scopedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function scopedConnectionIds(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

function mcpScopeFromEnv(): McpScope {
  const connectionIds = scopedConnectionIds(process.env.DBX_MCP_SCOPE_CONNECTION_IDS);
  const legacyConnectionId = scopedValue(process.env.DBX_MCP_SCOPE_CONNECTION_ID);
  if (connectionIds.length === 0 && legacyConnectionId) connectionIds.push(legacyConnectionId);
  return {
    connectionIds,
    connectionName: scopedValue(process.env.DBX_MCP_SCOPE_CONNECTION_NAME),
    database: scopedValue(process.env.DBX_MCP_SCOPE_DATABASE),
  };
}

function scopeEnabled(scope: McpScope): boolean {
  return scope.connectionIds.length > 0 || !!scope.connectionName;
}

function connectionMatchesScope(config: ConnectionConfig, scope: McpScope): boolean {
  if (scope.connectionIds.length > 0) return scope.connectionIds.includes(config.id);
  return !!scope.connectionName && config.name === scope.connectionName;
}

async function loadMcpPolicy(backend: Backend): Promise<{ policy?: McpGlobalPolicy; error?: ReturnType<typeof toolError> }> {
  try {
    return { policy: await backend.loadMcpGlobalPolicy() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: backendPolicyToolError(message) ?? toolError("MCP_POLICY_UNAVAILABLE", message) };
  }
}

async function loadScopedConnections(backend: Backend, scope: McpScope, policy: McpGlobalPolicy): Promise<ConnectionConfig[]> {
  const connections = (await backend.loadConnections()).filter((config) => isConnectionAllowedByMcpPolicy(config, policy));
  if (!scopeEnabled(scope)) return connections;
  return connections.filter((config) => connectionMatchesScope(config, scope));
}

function readOnlyToolError(config: ConnectionConfig, policy: McpGlobalPolicy): ReturnType<typeof toolError> {
  return toolError(policy.readOnly ? "MCP_READ_ONLY" : "CONNECTION_READ_ONLY", mcpReadOnlyReason(config, policy));
}

async function connectionManagementError(backend: Backend): Promise<ReturnType<typeof toolError> | undefined> {
  const loaded = await loadMcpPolicy(backend);
  if (loaded.error) return loaded.error;
  if (loaded.policy!.readOnly) {
    return toolError("MCP_READ_ONLY", "DBX global MCP read-only mode is enabled. Connection management is not allowed.");
  }
  return undefined;
}

async function resolveConnection(
  backend: Backend,
  scope: McpScope,
  requestedId?: string,
  requestedName?: string,
): Promise<{ config?: ConnectionConfig; policy?: McpGlobalPolicy; error?: ReturnType<typeof toolError> }> {
  const loaded = await loadMcpPolicy(backend);
  if (loaded.error) return { error: loaded.error };
  const policy = loaded.policy!;
  const connections = await backend.loadConnections();
  // connection_id takes priority over connection_name when both are provided.
  if (requestedId?.trim()) {
    const config = connections.find((c) => c.id === requestedId.trim());
    if (!config) return { error: toolError("CONNECTION_NOT_FOUND", `Connection with id "${requestedId}" not found.`) };
    if (!isConnectionAllowedByMcpPolicy(config, policy)) {
      return { error: toolError("CONNECTION_OUT_OF_SCOPE", `Connection "${requestedId}" is not available to MCP.`) };
    }
    // In scoped mode, verify the resolved connection is within the scope.
    if (scopeEnabled(scope) && !connectionMatchesScope(config, scope)) {
      return { error: toolError("CONNECTION_OUT_OF_SCOPE", `Connection "${requestedId}" is outside this DBX AI session scope.`) };
    }
    return { config, policy };
  }

  if (!scopeEnabled(scope)) {
    if (!requestedName?.trim()) return { error: toolError("CONNECTION_NOT_FOUND", "Connection name is required.") };
    const named = connections.filter((c) => c.name.toLowerCase() === requestedName.trim().toLowerCase());
    const matching = named.filter((config) => isConnectionAllowedByMcpPolicy(config, policy));
    if (matching.length === 0) {
      const code = named.length > 0 ? "CONNECTION_OUT_OF_SCOPE" : "CONNECTION_NOT_FOUND";
      return { error: toolError(code, `Connection "${requestedName}" ${named.length > 0 ? "is not available to MCP" : "not found"}.`) };
    }
    if (matching.length > 1) {
      const lines = matching.map((c) => `- ${c.id}: ${c.db_type} @ ${c.host}:${c.port}`);
      return {
        error: toolError("AMBIGUOUS_CONNECTION", `Multiple connections found with name "${requestedName}". Please specify connection_id:\n${lines.join("\n")}`),
      };
    }
    return { config: matching[0], policy };
  }

  const sessionScopedConnections = connections.filter((config) => connectionMatchesScope(config, scope));
  const scopedConnections = sessionScopedConnections.filter((config) => isConnectionAllowedByMcpPolicy(config, policy));
  if (scopedConnections.length === 0) {
    const code = sessionScopedConnections.length > 0 ? "CONNECTION_OUT_OF_SCOPE" : "CONNECTION_NOT_FOUND";
    return { error: toolError(code, sessionScopedConnections.length > 0
      ? "The DBX AI session scope is outside the global MCP connection allowlist."
      : "No scoped DBX connections were found.") };
  }
  if (requestedName?.trim()) {
    const value = requestedName.trim();
    const matching = scopedConnections.filter((config) => config.id === value || config.name.toLowerCase() === value.toLowerCase());
    if (matching.length === 0) {
      return { error: toolError("CONNECTION_OUT_OF_SCOPE", `Connection "${requestedName}" is outside this DBX AI session scope.`) };
    }
    if (matching.length > 1) {
      const lines = matching.map((config) => `- ${config.id}: ${config.db_type} @ ${config.host}:${config.port}`);
      return { error: toolError("AMBIGUOUS_CONNECTION", `Multiple scoped connections found with name "${requestedName}". Please specify connection_id:\n${lines.join("\n")}`) };
    }
    return { config: matching[0], policy };
  }
  if (scopedConnections.length === 1) return { config: scopedConnections[0], policy };
  return { error: toolError("CONNECTION_REQUIRED", "This MCP session includes multiple DBX connections. Specify connection_id or connection_name.") };
}

function validateQueryPolicy(
  config: ConnectionConfig,
  policy: McpGlobalPolicy,
  sql: string,
  database: string | undefined,
  allowMultipleStatements = false,
): { safety?: ReturnType<typeof effectiveMcpSqlSafety>; error?: ReturnType<typeof toolError> } {
  const safety = effectiveMcpSqlSafety(config, policy);
  if (config.db_type === "mongodb") {
    const aggregate = parseMongoAggregateCommand(sql);
    const write = parseMongoWriteCommand(sql);
    const mutation = !!write || !!(aggregate && mongoAggregateWriteStage(aggregate.pipeline)) || isLikelyMongoMutation(sql);
    if (mutation && isMcpReadOnly(config, policy)) return { error: readOnlyToolError(config, policy) };
    const decision = aggregate
      ? evaluateMongoAggregateSafety(aggregate, safety)
      : write
        ? evaluateMongoWriteSafety(write, safety)
        : undefined;
    if (decision && !decision.allowed) return { error: toolError("SQL_BLOCKED", decision.reason ?? "Query blocked.") };
    const targetDatabase = database ?? config.database;
    const targetsProduction = aggregate
      ? mongoAggregateTargetsProductionDatabase(config, targetDatabase, aggregate.pipeline)
      : isProductionDatabase(config, targetDatabase);
    if (mutation && targetsProduction) {
      return { error: toolError("PRODUCTION_WRITE_BLOCKED", "MCP cannot execute writes against a production database. Return the command for a user to review and run in DBX.") };
    }
    return { safety };
  }

  const hashLineComments = supportsHashLineComments(config.db_type);
  const risk = classifySqlRisk(sql, { hashLineComments }).risk;
  if (isSqlRiskMutation(risk) && isMcpReadOnly(config, policy)) return { error: readOnlyToolError(config, policy) };
  const decision = evaluateSqlSafety(sql, { ...safety, allowMultipleStatements, hashLineComments });
  if (!decision.allowed) return { error: toolError("SQL_BLOCKED", decision.reason ?? "SQL blocked.") };
  const production = assessProductionSql(sql, config, database ?? config.database);
  if (production.active && production.isMutation) {
    return { error: toolError("PRODUCTION_WRITE_BLOCKED", "MCP cannot execute writes against a production database. Return the SQL for a user to review and run in DBX.") };
  }
  return { safety };
}

export function createDbxMcpServer(backend: Backend, options: { isWebMode?: boolean } = {}): McpServer {
  const isWebMode = options.isWebMode ?? !!process.env.DBX_WEB_URL;
  const scope = mcpScopeFromEnv();
  const scoped = scopeEnabled(scope);
  const server = new McpServer({
    name: "dbx",
    version: DBX_MCP_PACKAGE_VERSION,
  });

  server.tool("dbx_list_connections", "List database connections available to this MCP session", {}, async () => {
    const loaded = await loadMcpPolicy(backend);
    if (loaded.error) return loaded.error;
    const connections = await loadScopedConnections(backend, scope, loaded.policy!);
    if (connections.length === 0) return text("No MCP-enabled connections are available in DBX.");
    const rows = connections.map((c) => {
      const access = isMcpReadOnly(c, loaded.policy!)
        ? "read_only"
        : loaded.policy!.allowDangerousSql
          ? "high_risk_write"
          : "safe_write";
      return [c.id, c.name, c.db_type, c.host, String(c.port), c.database || "", access];
    });
    return text(mdTable(["ID", "Name", "Type", "Host", "Port", "Database", "Access"], rows));
  });

  server.tool(
    "dbx_list_tables",
    "List tables and views for a database connection",
    {
      connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to disambiguate when multiple connections share the same name)"),
      connection_name: z.string().optional().describe("Name of the DBX connection"),
      database: z.string().optional().describe("Database name; for Dameng this is also accepted as a schema alias"),
      schema: z.string().optional().describe("Schema name (default: public for PostgreSQL, login user for Dameng)"),
    },
    async ({ connection_id, connection_name, database, schema }) => {
      const { config, error } = await resolveConnection(backend, scope, connection_id, connection_name);
      if (error) return error;
      const resolvedConfig = config!;
      const scopeValue = metadataScope(resolvedConfig, database ?? scope.database, schema);
      const tables = await backend.listTables(scopeValue.config, scopeValue.schema);
      if (tables.length === 0) return text("No tables found.");
      const rows = tables.map((t) => [t.name, t.type]);
      return labeledText(resolvedConfig, mdTable(["Table", "Type"], rows));
    },
  );

  server.tool(
    "dbx_describe_table",
    "Get column definitions for a table",
    {
      connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to disambiguate when multiple connections share the same name)"),
      connection_name: z.string().optional().describe("Name of the DBX connection"),
      table: z.string().describe("Table name"),
      database: z.string().optional().describe("Database name; for Dameng this is also accepted as a schema alias"),
      schema: z.string().optional().describe("Schema name (default: public for PostgreSQL, login user for Dameng)"),
    },
    async ({ connection_id, connection_name, table, database, schema }) => {
      const { config, error } = await resolveConnection(backend, scope, connection_id, connection_name);
      if (error) return error;
      const resolvedConfig = config!;
      const scopeValue = metadataScope(resolvedConfig, database ?? scope.database, schema);
      const columns = await backend.describeTable(scopeValue.config, table, scopeValue.schema);
      if (columns.length === 0) return text("No columns found.");
      const rows = columns.map((c) => [c.is_primary_key ? `${c.name} (PK)` : c.name, c.data_type, c.is_nullable ? "YES" : "NO", c.column_default ?? "", c.comment ?? ""]);
      return labeledText(resolvedConfig, mdTable(["Column", "Type", "Nullable", "Default", "Comment"], rows));
    },
  );

  server.tool(
    "dbx_execute_query",
    "Execute a SQL query on a database connection (max 100 rows returned)",
    {
      connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to disambiguate when multiple connections share the same name)"),
      connection_name: z.string().optional().describe("Name of the DBX connection"),
      database: z.string().optional().describe("Database name"),
      sql: z.string().describe("SQL query to execute"),
    },
    async ({ connection_id, connection_name, database, sql }) => {
      logSqlDiagnostic("dbx_execute_query", sql, { connection_id, connection_name, database });
      const { config, policy, error } = await resolveConnection(backend, scope, connection_id, connection_name);
      if (error) return error;
      const scopedConfig = config!;
      if (scopedConfig.db_type === "redis") {
        return toolError("REDIS_COMMAND_REQUIRED", "Redis connections do not accept SQL through dbx_execute_query. Use dbx_execute_redis_command with a Redis command such as GET key or INFO.");
      }
      try {
        const statements = scopedConfig.db_type === "mongodb" ? [sql] : splitSqlStatements(sql, { hashLineComments: supportsHashLineComments(scopedConfig.db_type) });
        if (statements.length === 0) return toolError("SQL_BLOCKED", "SQL is empty.");
        if (scopedConfig.db_type !== "mongodb" && statements.length > 1) {
          const batchValidation = validateQueryPolicy(scopedConfig, policy!, sql, database ?? scope.database, true);
          if (batchValidation.error) return batchValidation.error;
        }
        const results = [];
        for (let index = 0; index < statements.length; index++) {
          // Re-resolve policy and scope immediately before every statement so a
          // setting change takes effect within an existing MCP process.
          const refreshed = await resolveConnection(backend, scope, connection_id, connection_name);
          if (refreshed.error) return refreshed.error;
          const statement = statements[index];
          const targetDatabase = database ?? scope.database;
          const validation = validateQueryPolicy(refreshed.config!, refreshed.policy!, statement, targetDatabase);
          if (validation.error) {
            if (statements.length > 1 && validation.error.content[0]?.type === "text") {
              validation.error.content[0].text = validation.error.content[0].text.replace(": ", `: Statement ${index + 1}: `);
            }
            return validation.error;
          }
          results.push(await backend.executeQuery(withDatabase(refreshed.config!, targetDatabase), statement, { safety: validation.safety }));
        }
        if (results.length === 1) return labeledText(scopedConfig, formatQueryToolResult(results[0]).content[0].text);
        return labeledText(scopedConfig, results.map((result, index) => formatQueryToolResult(result, `Statement ${index + 1}`).content[0].text).join("\n\n"));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const policyError = backendPolicyToolError(msg);
        if (policyError) return policyError;
        return toolError("QUERY_ERROR", msg);
      }
    },
  );

  server.tool(
    "dbx_execute_redis_command",
    "Execute a Redis command on a Redis connection",
    {
      connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to disambiguate when multiple connections share the same name)"),
      connection_name: z.string().optional().describe("Name of the DBX Redis connection"),
      db: z.number().int().min(0).optional().describe("Redis logical database number (default: scoped/default database or 0)"),
      command: z.string().describe("Redis command to execute, for example: GET mykey, INFO, or DBSIZE"),
    },
    async ({ connection_id, connection_name, db, command }) => {
      const { config, policy, error } = await resolveConnection(backend, scope, connection_id, connection_name);
      if (error) return error;
      const scopedConfig = config!;
      if (scopedConfig.db_type !== "redis") {
        return toolError("INVALID_CONNECTION_TYPE", `Connection "${scopedConfig.name}" is ${scopedConfig.db_type}, not Redis.`);
      }
      if (!backend.executeRedisCommand) {
        return toolError("UNSUPPORTED_BACKEND", "This DBX backend does not support Redis command execution.");
      }
      const safety = evaluateRedisCommandSafety(command, effectiveMcpSqlSafety(scopedConfig, policy!));
      if (!safety.allowed) {
        return isMcpReadOnly(scopedConfig, policy!)
          ? readOnlyToolError(scopedConfig, policy!)
          : toolError("REDIS_COMMAND_BLOCKED", safety.reason ?? "Redis command blocked.");
      }
      if (isProductionDatabase(scopedConfig, String(defaultRedisDb(scopedConfig, scope, db))) && safety.safety !== "allowed") {
        return toolError("PRODUCTION_WRITE_BLOCKED", "MCP cannot execute write or dangerous Redis commands against a production database.");
      }
      try {
        const result = await backend.executeRedisCommand(scopedConfig, defaultRedisDb(scopedConfig, scope, db), command, {
          skipSafetyCheck: safety.skipSafetyCheck,
          mcpRequest: true,
        });
        return labeledText(scopedConfig, formatRedisCommandToolResult(result).content[0].text);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const policyError = backendPolicyToolError(msg);
        if (policyError) return policyError;
        return toolError("REDIS_COMMAND_ERROR", msg);
      }
    },
  );

  server.tool(
    "dbx_get_schema_context",
    "Get compact table and column context for writing SQL",
    {
      connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to disambiguate when multiple connections share the same name)"),
      connection_name: z.string().optional().describe("Name of the DBX connection"),
      database: z.string().optional().describe("Database name"),
      schema: z.string().optional().describe("Schema name (default: public for PostgreSQL)"),
      tables: z.array(z.string()).optional().describe("Specific table names to include"),
      max_tables: z.number().int().min(1).max(20).default(8).describe("Maximum number of tables to include"),
    },
    async ({ connection_id, connection_name, database, schema, tables, max_tables }) => {
      const { config, error } = await resolveConnection(backend, scope, connection_id, connection_name);
      if (error) return error;
      const resolvedConfig = config!;
      const context = await buildSchemaContext(backend, withDatabase(resolvedConfig, database ?? scope.database), {
        schema,
        tables,
        maxTables: max_tables,
      });
      if (context.tables.length === 0) return text("No matching tables found.");
      return labeledText(resolvedConfig, formatSchemaContext(context));
    },
  );

  if (!scoped) {
    server.tool(
      "dbx_add_connection",
      "Add a new database connection to DBX",
      {
        name: z.string().describe("Connection name"),
        db_type: z.string().describe(DBX_CONNECTION_TYPE_DESCRIPTION),
        host: z.string().describe("Database host; for cloudflare-d1, use the Cloudflare Account ID"),
        port: z.number().optional().describe("Database port (TDengine defaults to 6041, IoTDB defaults to 6667, XuguDB defaults to 5138)"),
        username: z.string().default("").describe("Username"),
        password: z.string().default("").describe("Password; for cloudflare-d1, use the API Token"),
        database: z.string().optional().describe("Default database name; for cloudflare-d1, use the D1 Database ID"),
        ssl: z.boolean().default(false).describe("Enable SSL"),
        driver_profile: z.string().optional().describe("Driver profile (e.g. 'gbase8a', 'gbase8s')"),
      },
      async ({ name, db_type, host, port, username, password, database, ssl, driver_profile }) => {
        const managementError = await connectionManagementError(backend);
        if (managementError) return managementError;
        const existing = await backend.findConnection(name);
        if (existing) return text(`Connection "${name}" already exists.`);
        const DEFAULT_PORTS: Record<string, number> = {
          kwdb: 26257,
          rqlite: 4001,
          "cloudflare-d1": 443,
          tdengine: 6041,
          oscar: 2003,
          iotdb: 6667,
          xugu: 5138,
        };
        const resolvedPort = port ?? DEFAULT_PORTS[db_type] ?? (FILE_CAPABLE_CONNECTION_TYPES.has(db_type) ? 0 : undefined);
        if (resolvedPort === undefined) return text("Port is required for this database type.");
        const refreshedManagementError = await connectionManagementError(backend);
        if (refreshedManagementError) return refreshedManagementError;
        const config = await backend.addConnection({
          name,
          db_type,
          host,
          port: resolvedPort,
          username,
          password,
          database,
          ssl,
          driver_profile,
          ssh_enabled: false,
        } as Omit<ConnectionConfig, "id">, { mcpRequest: true });
        await notifyReload();
        return text(`Connection "${config.name}" added (id: ${config.id}).`);
      },
    );

    server.tool(
      "dbx_remove_connection",
      "Remove a database connection from DBX",
      {
        connection_name: z.string().describe("Name of the connection to remove"),
        connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to remove by id instead of name)"),
      },
      async ({ connection_name, connection_id }) => {
        const resolved = await resolveConnection(backend, scope, connection_id, connection_name);
        if (resolved.error) return resolved.error;
        const target = resolved.config!;
        const managementError = await connectionManagementError(backend);
        if (managementError) return managementError;
        const removed = backend.removeConnectionById
          ? await backend.removeConnectionById(target.id, { mcpRequest: true })
          : await backend.removeConnection(target.name, { mcpRequest: true });
        if (!removed) return toolError("CONNECTION_NOT_FOUND", `Connection "${target.name}" (id: ${target.id}) not found.`);
        await notifyReload();
        return text(`Connection "${target.name}" (id: ${target.id}) removed.`);
      },
    );
  }

  // Desktop-only tools: open table and execute-and-show require the Tauri bridge
  if (!isWebMode && !scoped) {
    server.tool(
      "dbx_open_table",
      "Open a table in DBX desktop app UI. Requires DBX to be running.",
      {
        connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to disambiguate when multiple connections share the same name)"),
        connection_name: z.string().optional().describe("Name of the DBX connection"),
        table: z.string().describe("Table name to open"),
        database: z.string().optional().describe("Database name"),
        schema: z.string().optional().describe("Schema name"),
      },
      async ({ connection_id, connection_name, table, database, schema }) => {
        const { config, error } = await resolveConnection(backend, scope, connection_id, connection_name);
        if (error) return error;
        const resolvedConfig = config!;
        return bridgeRequest("/open-table", { connection_id: resolvedConfig.id, connection_name: resolvedConfig.name, table, database, schema }, `Opened ${table} in DBX`);
      },
    );

    server.tool(
      "dbx_execute_and_show",
      "Execute a SQL query in DBX desktop app UI and show results there. Requires DBX to be running.",
      {
        connection_id: z.string().optional().describe("Unique ID of the DBX connection (use this to disambiguate when multiple connections share the same name)"),
        connection_name: z.string().optional().describe("Name of the DBX connection"),
        sql: z.string().describe("SQL query to execute"),
        database: z.string().optional().describe("Database name"),
      },
      async ({ connection_id, connection_name, sql, database }) => {
        const { config, policy, error } = await resolveConnection(backend, scope, connection_id, connection_name);
        if (error) return error;
        const resolvedConfig = config!;
        if (!supportsSqlQuery(resolvedConfig.db_type)) {
          const replacement = resolvedConfig.db_type === "redis" ? "dbx_execute_redis_command" : "dbx_execute_query";
          return toolError(
            "UNSUPPORTED_OPERATION",
            `dbx_execute_and_show only supports SQL connections. Use ${replacement} for ${resolvedConfig.db_type}.`,
          );
        }
        const targetDatabase = database ?? scope.database;
        const validation = validateQueryPolicy(resolvedConfig, policy!, sql, targetDatabase, true);
        if (validation.error) return validation.error;
        logSqlDiagnostic("dbx_execute_in_app", sql, { connection_id: resolvedConfig.id, connection_name: resolvedConfig.name, database });
        return bridgeRequest(
          "/execute-query",
          {
            connection_id: resolvedConfig.id,
            connection_name: resolvedConfig.name,
            sql,
            database,
          },
          "Query executed and shown in DBX",
        );
      },
    );
  }

  return server;
}

async function bridgeRequest(path: string, body: Record<string, unknown>, successMsg: string) {
  const res = await postBridge(path, body);
  if (res.ok) return text(successMsg);
  let errorText = res.text;
  try {
    const payload = JSON.parse(res.text) as unknown;
    if (payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { error?: unknown }).error === "string") {
      errorText = (payload as { error: string }).error;
    }
  } catch {
    // The desktop bridge also uses plain-text errors for a few UI endpoints.
  }
  for (const code of [
    "MCP_POLICY_UNAVAILABLE",
    "MCP_READ_ONLY",
    "CONNECTION_OUT_OF_SCOPE",
    "CONNECTION_READ_ONLY",
    "PRODUCTION_DATABASE_READ_ONLY",
    "SQL_BLOCKED",
    "UNSUPPORTED_OPERATION",
    "QUERY_ERROR",
  ] as const) {
    const marker = `${code}:`;
    const markerIndex = errorText.indexOf(marker);
    if (markerIndex >= 0) return toolError(code, errorText.slice(markerIndex + marker.length).trim());
  }
  const message = errorText.startsWith("DBX is not running") ? errorText : `Failed: ${errorText}`;
  return toolError("DBX_NOT_RUNNING", message);
}

async function main() {
  const backend = await createBackend();
  const server = createDbxMcpServer(backend);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((e) => {
    console.error("MCP Server failed to start:", e);
    process.exit(1);
  });
}
