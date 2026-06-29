import { uuid } from "@/lib/utils";

export type QueryPaneSplitDirection = "horizontal" | "vertical";
export type QueryPaneDropPosition = "top" | "right" | "bottom" | "left";

export type QueryPaneLayoutNode =
  | {
      id: string;
      type: "leaf";
      tabId: string;
    }
  | {
      id: string;
      type: "split";
      direction: QueryPaneSplitDirection;
      children: QueryPaneLayoutNode[];
      sizes?: number[];
    };

export function createQueryPaneLeaf(tabId: string): QueryPaneLayoutNode {
  return { id: uuid(), type: "leaf", tabId };
}

export function normalizeQueryPaneLayout(layout: QueryPaneLayoutNode | null | undefined, tabIds: readonly string[], activeTabId: string | null | undefined): QueryPaneLayoutNode | null {
  const validTabIds = new Set(tabIds);
  const usedTabIds = new Set<string>();

  function visit(node: QueryPaneLayoutNode): QueryPaneLayoutNode | null {
    if (node.type === "leaf") {
      if (!validTabIds.has(node.tabId) || usedTabIds.has(node.tabId)) return null;
      usedTabIds.add(node.tabId);
      return node;
    }

    const children = node.children.map(visit).filter((child): child is QueryPaneLayoutNode => !!child);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...node, children, sizes: normalizedSizes(node.sizes, children.length) };
  }

  const normalized = layout ? visit(layout) : null;
  if (normalized) return normalized;

  const fallbackTabId = activeTabId && validTabIds.has(activeTabId) ? activeTabId : tabIds[0];
  return fallbackTabId ? createQueryPaneLeaf(fallbackTabId) : null;
}

export function queryPaneLayoutTabIds(layout: QueryPaneLayoutNode | null | undefined): string[] {
  if (!layout) return [];
  if (layout.type === "leaf") return [layout.tabId];
  return layout.children.flatMap(queryPaneLayoutTabIds);
}

export function queryPaneLayoutHasTab(layout: QueryPaneLayoutNode | null | undefined, tabId: string): boolean {
  return queryPaneLayoutTabIds(layout).includes(tabId);
}

export function splitQueryPaneLayout(layout: QueryPaneLayoutNode | null | undefined, targetTabId: string, newTabId: string, position: QueryPaneDropPosition): QueryPaneLayoutNode {
  const base = layout ?? createQueryPaneLeaf(targetTabId);
  const direction: QueryPaneSplitDirection = position === "left" || position === "right" ? "vertical" : "horizontal";
  const before = position === "left" || position === "top";
  const newLeaf = createQueryPaneLeaf(newTabId);

  function visit(node: QueryPaneLayoutNode): QueryPaneLayoutNode {
    if (node.type === "leaf") {
      if (node.tabId !== targetTabId) return node;
      const children = before ? [newLeaf, node] : [node, newLeaf];
      return { id: uuid(), type: "split", direction, children, sizes: evenSizes(children.length) };
    }

    return { ...node, children: node.children.map(visit) };
  }

  return normalizeNestedSplits(visit(base));
}

export function removeTabFromQueryPaneLayout(layout: QueryPaneLayoutNode | null | undefined, tabId: string): QueryPaneLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") return layout.tabId === tabId ? null : layout;
  const children = layout.children.map((child) => removeTabFromQueryPaneLayout(child, tabId)).filter((child): child is QueryPaneLayoutNode => !!child);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...layout, children, sizes: normalizedSizes(layout.sizes, children.length) };
}

export function replaceQueryPaneTab(layout: QueryPaneLayoutNode | null | undefined, fromTabId: string, toTabId: string): QueryPaneLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") return layout.tabId === fromTabId ? { ...layout, tabId: toTabId } : layout;
  return { ...layout, children: layout.children.map((child) => replaceQueryPaneTab(child, fromTabId, toTabId)).filter((child): child is QueryPaneLayoutNode => !!child) };
}

export function resizeQueryPaneSplit(layout: QueryPaneLayoutNode | null | undefined, splitId: string, sizes: number[]): QueryPaneLayoutNode | null {
  if (!layout) return null;
  if (layout.type === "leaf") return layout;
  if (layout.id === splitId) {
    const nextSizes = normalizedSizes(sizes, layout.children.length);
    return sizesEqual(layout.sizes, nextSizes) ? layout : { ...layout, sizes: nextSizes };
  }

  let changed = false;
  const children = layout.children.map((child) => {
    const nextChild = resizeQueryPaneSplit(child, splitId, sizes) ?? child;
    if (nextChild !== child) changed = true;
    return nextChild;
  });
  return changed ? { ...layout, children } : layout;
}

function normalizeNestedSplits(node: QueryPaneLayoutNode): QueryPaneLayoutNode {
  if (node.type === "leaf") return node;
  const children = node.children.map(normalizeNestedSplits).flatMap((child) => (child.type === "split" && child.direction === node.direction ? child.children : [child]));
  return { ...node, children, sizes: evenSizes(children.length) };
}

function normalizedSizes(sizes: readonly number[] | undefined, count: number): number[] {
  if (!sizes || sizes.length !== count || sizes.some((size) => !Number.isFinite(size) || size <= 0)) return evenSizes(count);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return evenSizes(count);
  return sizes.map((size) => (size / total) * 100);
}

function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

function sizesEqual(left: readonly number[] | undefined, right: readonly number[]) {
  if (!left || left.length !== right.length) return false;
  return left.every((size, index) => Math.abs(size - right[index]) < 0.05);
}
