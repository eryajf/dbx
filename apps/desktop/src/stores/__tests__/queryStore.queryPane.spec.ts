import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

function installLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
  });
}

describe("queryStore query pane layout", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorage();
    setActivePinia(createPinia());
    vi.doMock("@/lib/api", () => ({}));
  });

  it("closes a split pane without closing its tab", async () => {
    const { useQueryStore } = await import("@/stores/queryStore");
    const store = useQueryStore();
    const firstId = store.createTab("conn-1", "db", "query_1");
    const secondId = store.createTab("conn-1", "db", "query_2");

    store.splitQueryPane(firstId, secondId, "right");
    store.closeQueryPane(secondId);

    expect(store.tabs.map((tab) => tab.id)).toEqual([firstId, secondId]);
    expect(store.activeTabId).toBe(firstId);
    expect(store.queryPaneLayout).toEqual({ id: expect.any(String), type: "leaf", tabId: firstId });
  });
});
