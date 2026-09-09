import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ saved: null as any }));
vi.mock("@/lib/backend/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend/api")>()),
  loadOpenTabsState: async () => mocks.saved,
  saveOpenTabsState: async (payload: unknown) => {
    mocks.saved = payload;
  },
  listDetachedTabHandoffs: async () => [],
}));
describe("update draft recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.saved = null;
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    setActivePinia(createPinia());
  });
  it("recovers SQL and structure drafts once even when normal restore and close protection are disabled", async () => {
    const { useQueryStore } = await import("@/stores/queryStore");
    const { useSettingsStore } = await import("@/stores/settingsStore");
    const { UPDATE_RESTORE_KEY } = await import("@/lib/app/updatePreparation");
    const settings = useSettingsStore();
    settings.updateEditorSettings({ openTabsRestoreMode: "none", confirmUnsavedSqlClose: false });
    const store = useQueryStore();
    const sqlId = store.createTab("conn", "db");
    store.updateSql(sqlId, "select unsaved;");
    const structureId = store.openTableStructure("conn", "db", undefined, "users");
    const draft = { dirty: true, initialized: true, ddlDraft: "alter table users add column name text" };
    store.tabs.find((tab) => tab.id === structureId)!.structureDraft = draft as any;
    await store.flushPendingPersist();
    localStorage.setItem(UPDATE_RESTORE_KEY, "1");
    setActivePinia(createPinia());
    useSettingsStore().updateEditorSettings({ openTabsRestoreMode: "none", confirmUnsavedSqlClose: false });
    const restored = useQueryStore();
    await restored.initOpenTabs({ validConnectionIds: ["conn"] });
    expect(restored.tabs.find((tab) => tab.id === sqlId)?.sql).toBe("select unsaved;");
    expect(restored.tabs.find((tab) => tab.id === structureId)?.structureDraft).toEqual(draft);
    expect(localStorage.getItem(UPDATE_RESTORE_KEY)).toBeNull();
    setActivePinia(createPinia());
    useSettingsStore().updateEditorSettings({ openTabsRestoreMode: "none" });
    const subsequent = useQueryStore();
    await subsequent.initOpenTabs({ validConnectionIds: ["conn"] });
    expect(subsequent.tabs).toEqual([]);
  });
});
