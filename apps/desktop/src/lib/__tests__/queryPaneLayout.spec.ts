import { describe, expect, it } from "vitest";
import { normalizeQueryPaneLayout, queryPaneLayoutTabIds, removeTabFromQueryPaneLayout, resizeQueryPaneSplit, splitQueryPaneLayout, type QueryPaneLayoutNode } from "@/lib/queryPaneLayout";

describe("queryPaneLayout", () => {
  it("splits a query tab to the requested side", () => {
    const layout: QueryPaneLayoutNode = { id: "root", type: "leaf", tabId: "tab-1" };

    const next = splitQueryPaneLayout(layout, "tab-1", "tab-2", "right");

    expect(next.type).toBe("split");
    if (next.type === "split") {
      expect(next.direction).toBe("vertical");
      expect(queryPaneLayoutTabIds(next)).toEqual(["tab-1", "tab-2"]);
      expect(next.sizes).toEqual([50, 50]);
    }
  });

  it("collapses empty branches when tabs are removed", () => {
    const layout: QueryPaneLayoutNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "leaf-1", type: "leaf", tabId: "tab-1" },
        { id: "leaf-2", type: "leaf", tabId: "tab-2" },
      ],
    };

    expect(removeTabFromQueryPaneLayout(layout, "tab-2")).toEqual({ id: "leaf-1", type: "leaf", tabId: "tab-1" });
  });

  it("normalizes stale and duplicate tabs", () => {
    const layout: QueryPaneLayoutNode = {
      id: "root",
      type: "split",
      direction: "vertical",
      children: [
        { id: "leaf-1", type: "leaf", tabId: "tab-1" },
        { id: "leaf-2", type: "leaf", tabId: "missing" },
        { id: "leaf-3", type: "leaf", tabId: "tab-1" },
      ],
    };

    expect(normalizeQueryPaneLayout(layout, ["tab-1"], "tab-1")).toEqual({ id: "leaf-1", type: "leaf", tabId: "tab-1" });
  });

  it("keeps the same layout object when resize sizes do not change", () => {
    const layout: QueryPaneLayoutNode = {
      id: "root",
      type: "split",
      direction: "vertical",
      sizes: [50, 50],
      children: [
        { id: "leaf-1", type: "leaf", tabId: "tab-1" },
        { id: "leaf-2", type: "leaf", tabId: "tab-2" },
      ],
    };

    expect(resizeQueryPaneSplit(layout, "root", [50, 50])).toBe(layout);
  });
});
