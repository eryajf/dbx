import { resolveDefaultDatabase } from "@/lib/defaultDatabase";
import { buildTableSelectSql } from "@/lib/tableSelectSql";
import type { ConnectionConfig, QueryTab, TreeNode } from "@/types/database";

interface NewQueryBaseTarget {
  connectionId: string;
  database: string;
  schema?: string;
}

export interface BlankNewQueryTarget extends NewQueryBaseTarget {
  kind: "blank";
  shouldRefreshDefaultDatabase: boolean;
}

export interface TableSelectNewQueryTarget extends NewQueryBaseTarget {
  kind: "table-select";
  tableName: string;
  shouldRefreshDefaultDatabase: false;
}

export type NewQueryTarget = BlankNewQueryTarget | TableSelectNewQueryTarget;

export type NewQueryContextSource = "tab" | "sidebar";

interface ResolveNewQueryTargetInput {
  activeTab?: Pick<QueryTab, "connectionId" | "database" | "schema" | "mode" | "tableMeta">;
  selectedTreeNode?: Pick<TreeNode, "connectionId" | "database" | "schema" | "tableName" | "type" | "label"> | null;
  activeConnectionId?: string | null;
  connections: Pick<ConnectionConfig, "id" | "database">[];
  preferredSource?: NewQueryContextSource;
}

interface BuildNewQueryTableSelectSqlInput {
  databaseType?: Parameters<typeof buildTableSelectSql>[0]["databaseType"];
  schema?: string;
  tableName: string;
}

type NewQueryContext = NonNullable<ResolveNewQueryTargetInput["activeTab"]> | NonNullable<ResolveNewQueryTargetInput["selectedTreeNode"]>;

const TABLE_SELECT_NEW_QUERY_LIMIT = 100;

export function findTreeNodeById(nodes: TreeNode[], id: string | null | undefined): TreeNode | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findTreeNodeById(node.children || [], id);
    if (found) return found;
  }
  return null;
}

export function resolveNewQueryTarget(input: ResolveNewQueryTargetInput): NewQueryTarget | null {
  const primaryContext = input.preferredSource === "sidebar" ? input.selectedTreeNode || undefined : input.activeTab;
  const secondaryContext = input.preferredSource === "sidebar" ? input.activeTab : input.selectedTreeNode || undefined;
  const primaryTarget = targetFromContext(primaryContext, input.connections);
  if (primaryTarget) return primaryTarget;
  const secondaryTarget = targetFromContext(secondaryContext, input.connections);
  if (secondaryTarget) return secondaryTarget;

  const activeConnection = input.activeConnectionId ? input.connections.find((connection) => connection.id === input.activeConnectionId) : undefined;
  const fallbackConnection = activeConnection || input.connections[0];
  return fallbackConnection
    ? {
        kind: "blank",
        connectionId: fallbackConnection.id,
        database: resolveDefaultDatabase(fallbackConnection, []),
        shouldRefreshDefaultDatabase: true,
      }
    : null;
}

export function buildNewQueryTableSelectSql(input: BuildNewQueryTableSelectSqlInput): Promise<string> {
  return buildTableSelectSql({
    databaseType: input.databaseType,
    schema: input.schema,
    tableName: input.tableName,
    limit: TABLE_SELECT_NEW_QUERY_LIMIT,
  });
}

function targetFromContext(context: NewQueryContext | undefined, connections: Pick<ConnectionConfig, "id" | "database">[]): NewQueryTarget | null {
  if (!context?.connectionId) return null;
  const connection = connections.find((item) => item.id === context.connectionId);
  if (!connection) return null;
  const database = context.database || resolveDefaultDatabase(connection, []);
  const tableName = tableNameFromContext(context);
  if (tableName) {
    return {
      kind: "table-select",
      connectionId: context.connectionId,
      database,
      schema: context.schema,
      tableName,
      shouldRefreshDefaultDatabase: false,
    };
  }
  return {
    kind: "blank",
    connectionId: context.connectionId,
    database,
    schema: context.schema,
    shouldRefreshDefaultDatabase: !context.database,
  };
}

function tableNameFromContext(context: NewQueryContext): string | null {
  if ("mode" in context) {
    return context.mode === "data" ? context.tableMeta?.tableName || null : null;
  }
  if (context.type === "table" || context.type === "view" || context.type === "materialized_view") {
    return context.tableName || context.label || null;
  }
  return null;
}
