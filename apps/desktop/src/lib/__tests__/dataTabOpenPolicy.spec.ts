import { describe, expect, it } from "vitest";
import { dataTabOpenModeFromTreeClick, findReusableDataTab, findSameDataTableTab, shouldReuseDataTab } from "@/lib/dataTabOpenPolicy";
import type { QueryTab } from "@/types/database";

function mouseEvent(modifiers: Partial<Pick<MouseEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {}): Pick<MouseEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> {
  return {
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    altKey: modifiers.altKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  };
}

function dataTab(id: string, title: string, connectionId = "conn", database = "app", schema?: string): QueryTab {
  return {
    id,
    title,
    connectionId,
    database,
    schema,
    sql: "",
    isExecuting: false,
    mode: "data",
  };
}

describe("dataTabOpenPolicy", () => {
  it("maps Cmd/Ctrl table clicks to new data tabs", () => {
    expect(dataTabOpenModeFromTreeClick("table", mouseEvent({ metaKey: true }))).toBe("new-tab");
    expect(dataTabOpenModeFromTreeClick("view", mouseEvent({ ctrlKey: true }))).toBe("new-tab");
    expect(dataTabOpenModeFromTreeClick("materialized_view", mouseEvent({ metaKey: true }))).toBe("new-tab");
  });

  it("leaves non-data nodes and selection modifiers available for tree selection", () => {
    expect(dataTabOpenModeFromTreeClick("database", mouseEvent({ metaKey: true }))).toBeNull();
    expect(dataTabOpenModeFromTreeClick("table", mouseEvent({ shiftKey: true }))).toBeNull();
    expect(dataTabOpenModeFromTreeClick("table", mouseEvent({ metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("disables data tab reuse only for explicit new-tab mode", () => {
    expect(shouldReuseDataTab("reuse", true)).toBe(true);
    expect(shouldReuseDataTab("reuse", false)).toBe(false);
    expect(shouldReuseDataTab("new-tab", true)).toBe(false);
  });

  it("prefers the active matching data tab when reusing a table tab", () => {
    const tabs = [dataTab("first", "orders"), dataTab("active", "users")];

    expect(findReusableDataTab(tabs, { connectionId: "conn", database: "app" }, "active")?.id).toBe("active");
  });

  it("finds existing same-table tabs by metadata or title", () => {
    const tabWithMetadata = dataTab("meta", "public.users", "conn", "app", "public");
    tabWithMetadata.tableMeta = { schema: "public", tableName: "users", columns: [], primaryKeys: [] };
    const tabWithTitle = dataTab("title", "public.orders", "conn", "app", "public");

    expect(findSameDataTableTab([tabWithMetadata], { connectionId: "conn", database: "app", schema: "public", tableName: "users", title: "public.users" })?.id).toBe("meta");
    expect(findSameDataTableTab([tabWithTitle], { connectionId: "conn", database: "app", schema: "public", tableName: "orders", title: "public.orders" })?.id).toBe("title");
  });
});
