// @vitest-environment happy-dom
import { createApp, nextTick } from "vue";
import { describe, it, expect, vi } from "vitest";
import { useMigrationStore } from "@/stores/migrationStore";
import Wizard from "./SecurityMigrationWizard.vue";
const mocks = vi.hoisted(() => ({ save: vi.fn().mockRejectedValue(new Error("unavailable")) }));
vi.mock("@/lib/backend/api", () => ({}));
vi.mock("@/i18n", () => ({ setLocale: vi.fn() }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/lib/export/saveTextFile", () => ({ saveTextFile: mocks.save }));
describe("migration failure actions", () => {
  it("shows a redacted diagnostic even when file saving fails and routes status retries correctly", async () => {
    const backend = { migrationStatus: vi.fn().mockRejectedValue(new Error("private transport detail")), migrationStart: vi.fn(), migrationRetry: vi.fn(), migrationCleanupBackups: vi.fn() };
    const store = useMigrationStore(backend);
    await store.initialize();
    store.state.step = 2;
    const root = document.createElement("div");
    const app = createApp(Wizard, { store });
    app.mount(root);
    try {
      const button = (label: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === label)!;
      button("migration.exportDiagnostic").click();
      await nextTick();
      await nextTick();
      expect(mocks.save).toHaveBeenCalledWith(expect.any(String), "dbx-migration-diagnostic.json", "JSON", "json");
      expect(root.querySelector("textarea")?.value).toContain("statusFailed");
      expect(root.querySelector("textarea")?.value).not.toContain("private transport detail");
      button("migration.retryStatus").click();
      await nextTick();
      expect(backend.migrationStatus).toHaveBeenCalledTimes(2);
      expect(backend.migrationRetry).not.toHaveBeenCalled();
    } finally {
      app.unmount();
    }
  });
});
