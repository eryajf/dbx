import type { QueryTab, TreeNodeType } from "@/types/database";

export type DataTabOpenMode = "reuse" | "new-tab";

export type DataTabTarget = {
  connectionId: string;
  database: string;
  schema?: string;
  tableName: string;
  title?: string;
};

type DataTabLike = Pick<QueryTab, "id" | "mode" | "connectionId" | "database" | "schema" | "title" | "tableMeta">;

type ShortcutLikeMouseEvent = Pick<MouseEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

const dataTreeNodeTypes = new Set<TreeNodeType>(["table", "view", "materialized_view"]);

export function isDataTreeNodeType(type: TreeNodeType): boolean {
  return dataTreeNodeTypes.has(type);
}

export function dataTabOpenModeFromTreeClick(type: TreeNodeType, event: ShortcutLikeMouseEvent): DataTabOpenMode | null {
  if (!isDataTreeNodeType(type)) return null;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) return "new-tab";
  return null;
}

export function shouldReuseDataTab(openMode: DataTabOpenMode, reuseDataTab: boolean): boolean {
  return openMode !== "new-tab" && reuseDataTab;
}

function sameDatabase(tab: DataTabLike, target: Pick<DataTabTarget, "connectionId" | "database">): boolean {
  return tab.mode === "data" && tab.connectionId === target.connectionId && tab.database === target.database;
}

function sameSchema(tab: DataTabLike, target: Pick<DataTabTarget, "schema">): boolean {
  return (tab.schema || "") === (target.schema || "");
}

function sameTableName(tab: DataTabLike, target: Pick<DataTabTarget, "tableName" | "title">): boolean {
  const metaTableName = tab.tableMeta?.tableName;
  if (metaTableName) return metaTableName === target.tableName;
  return tab.title === target.tableName || (!!target.title && tab.title === target.title);
}

export function isSameDataTableTab(tab: DataTabLike, target: DataTabTarget): boolean {
  return sameDatabase(tab, target) && sameSchema(tab, target) && sameTableName(tab, target);
}

export function findSameDataTableTab<T extends DataTabLike>(tabs: T[], target: DataTabTarget): T | undefined {
  return tabs.find((tab) => isSameDataTableTab(tab, target));
}

export function findReusableDataTab<T extends DataTabLike>(tabs: T[], target: Pick<DataTabTarget, "connectionId" | "database">, activeTabId?: string | null): T | undefined {
  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId && sameDatabase(tab, target)) : undefined;
  return activeTab ?? tabs.find((tab) => sameDatabase(tab, target));
}
