<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import LoginPage from "@/components/auth/LoginPage.vue";
import SecurityMigrationWizard from "@/components/migration/SecurityMigrationWizard.vue";
import { useMigrationStore } from "@/stores/migrationStore";
import { isTauriRuntime } from "@/lib/backend/tauriRuntime";
import { apiUrl, webPath } from "@/lib/common/webPath";

// App setup installs listeners and instantiates business stores, so even its import
// is deferred until authentication and the security migration have completed.
const App = defineAsyncComponent(() => import("./App.vue"));
const { t } = useI18n();
const migration = useMigrationStore();
const { blocking } = migration;
const checkingAuth = ref(true);
const loginRequired = ref(false);
const setupRequired = ref(false);
const authFailed = ref(false);
async function initialize() {
  checkingAuth.value = true;
  authFailed.value = false;
  try {
    if (!isTauriRuntime()) {
      const response = await fetch(apiUrl("/api/auth/check"), { credentials: "same-origin" });
      if (!response.ok) throw new Error("AUTH_CHECK_FAILED");
      const result = await response.json();
      if (typeof result.required !== "boolean" || typeof result.authenticated !== "boolean") throw new Error("AUTH_CHECK_FAILED");
      setupRequired.value = result.setup_required === true;
      loginRequired.value = setupRequired.value || (result.required && !result.authenticated);
      if (loginRequired.value) {
        history.replaceState(null, "", webPath("/login"));
        return;
      }
    }
    await migration.initialize();
  } catch {
    authFailed.value = true;
  } finally {
    checkingAuth.value = false;
  }
}
async function authenticated() {
  history.replaceState(null, "", webPath("/"));
  await initialize();
}
onMounted(initialize);
</script>
<template>
  <div v-if="checkingAuth || authFailed" class="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background text-foreground" role="status">
    <p>{{ t(authFailed ? "migration.authFailed" : "migration.checking") }}</p>
    <button v-if="authFailed" class="rounded border px-4 py-2" @click="initialize">{{ t("migration.retry") }}</button>
  </div>
  <LoginPage v-else-if="loginRequired" :setup-mode="setupRequired" @authenticated="authenticated" />
  <SecurityMigrationWizard v-else-if="blocking" :store="migration" />
  <App v-else />
</template>
