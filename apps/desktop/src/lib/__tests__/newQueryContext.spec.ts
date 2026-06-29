import { describe, expect, it, vi } from "vitest";
import { buildNewQueryTableSelectSql, resolveNewQueryTarget } from "@/lib/newQueryContext";
import type { ConnectionConfig, QueryTab, TreeNode } from "@/types/database";

const mocks = vi.hoisted(() => ({
  buildTableSelectSql: vi.fn(async (options) => `select:${options.databaseType}:${options.schema ?? ""}:${options.tableName}:${options.limit}`),
}));

vi.mock("@/lib/api", () => ({
  buildTableSelectSql: mocks.buildTableSelectSql,
}));

function connection(id = "conn"): Pick<ConnectionConfig, "id" | "database"> {
  return { id, database: "app" };
}

describe("newQueryContext", () => {
  it("uses the active data tab as a table-select query target", () => {
    const activeTab = {
      connectionId: "conn",
      database: "app",
      schema: "public",
      mode: "data",
      tableMeta: {
        schema: "public",
        tableName: "users",
        columns: [],
        primaryKeys: [],
      },
    } as Pick<QueryTab, "connectionId" | "database" | "schema" | "mode" | "tableMeta">;

    expect(resolveNewQueryTarget({ activeTab, connections: [connection()], preferredSource: "tab" })).toEqual({
      kind: "table-select",
      connectionId: "conn",
      database: "app",
      schema: "public",
      tableName: "users",
      shouldRefreshDefaultDatabase: false,
    });
  });

  it("uses selected table-like sidebar nodes as table-select query targets", () => {
    const selectedTreeNode = {
      id: "node",
      label: "orders",
      type: "view",
      connectionId: "conn",
      database: "app",
      schema: "reporting",
    } as Pick<TreeNode, "id" | "label" | "type" | "connectionId" | "database" | "schema">;

    expect(resolveNewQueryTarget({ selectedTreeNode, connections: [connection()], preferredSource: "sidebar" })).toEqual({
      kind: "table-select",
      connectionId: "conn",
      database: "app",
      schema: "reporting",
      tableName: "orders",
      shouldRefreshDefaultDatabase: false,
    });
  });

  it("keeps query tabs and database nodes as blank query targets", () => {
    const activeTab = {
      connectionId: "conn",
      database: "app",
      schema: "public",
      mode: "query",
    } as Pick<QueryTab, "connectionId" | "database" | "schema" | "mode" | "tableMeta">;
    const selectedTreeNode = {
      id: "db",
      label: "app",
      type: "database",
      connectionId: "conn",
      database: "app",
    } as Pick<TreeNode, "id" | "label" | "type" | "connectionId" | "database" | "schema">;

    expect(resolveNewQueryTarget({ activeTab, selectedTreeNode, connections: [connection()], preferredSource: "tab" })).toEqual({
      kind: "blank",
      connectionId: "conn",
      database: "app",
      schema: "public",
      shouldRefreshDefaultDatabase: false,
    });
    expect(resolveNewQueryTarget({ activeTab, selectedTreeNode, connections: [connection()], preferredSource: "sidebar" })).toEqual({
      kind: "blank",
      connectionId: "conn",
      database: "app",
      schema: undefined,
      shouldRefreshDefaultDatabase: false,
    });
  });

  it("builds table-select SQL with a 100 row limit", async () => {
    await expect(buildNewQueryTableSelectSql({ databaseType: "mysql", schema: "public", tableName: "users" })).resolves.toBe("select:mysql:public:users:100");

    expect(mocks.buildTableSelectSql).toHaveBeenCalledWith({
      databaseType: "mysql",
      schema: "public",
      tableName: "users",
      limit: 100,
    });
  });
});
