<script setup lang="ts">
import { reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PasswordInput from "@/components/ui/PasswordInput.vue";
import type { ConnectionCredentialField, ConnectionCredentialValues } from "@/lib/connection/connectionPasswordPersistence";
import { useConnectionCredentialStore } from "@/stores/connectionCredentialStore";

const { t } = useI18n();
const credentialStore = useConnectionCredentialStore();
const credentials = reactive<Record<ConnectionCredentialField, string>>({
  password: "",
  redisSentinelPassword: "",
  mqToken: "",
  mqBasicPassword: "",
  mqApiKeyValue: "",
  mqOauthClientSecret: "",
});

const credentialLabelKeys: Record<ConnectionCredentialField, string> = {
  password: "connection.password",
  redisSentinelPassword: "connection.redisSentinelPassword",
  mqToken: "connection.mqToken",
  mqBasicPassword: "connection.password",
  mqApiKeyValue: "connection.mqApiKeyValue",
  mqOauthClientSecret: "connection.mqOauthClientSecret",
};

function resetCredentials() {
  for (const field of Object.keys(credentials) as ConnectionCredentialField[]) credentials[field] = "";
}

watch(
  () => credentialStore.pending,
  () => {
    resetCredentials();
  },
);

function updateOpen(open: boolean) {
  if (!open) credentialStore.cancel();
}

function submit() {
  const values: ConnectionCredentialValues = {};
  for (const field of credentialStore.pending?.fields || []) values[field] = credentials[field];
  resetCredentials();
  credentialStore.confirm(values);
}
</script>

<template>
  <Dialog :open="!!credentialStore.pending" @update:open="updateOpen">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ t("connectionPasswordPrompt.title") }}</DialogTitle>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="submit">
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground">
            {{ t("connectionPasswordPrompt.description", { name: credentialStore.pending?.connectionName || "-" }) }}
          </p>
          <label v-for="(field, index) in credentialStore.pending?.fields || []" :key="field" class="block space-y-1.5">
            <span class="text-xs font-medium text-foreground">{{ t(credentialLabelKeys[field]) }}</span>
            <PasswordInput v-model="credentials[field]" autocomplete="off" :autofocus="index === 0" />
          </label>
          <p class="text-xs text-muted-foreground">{{ t("connectionPasswordPrompt.notSaved") }}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" @click="credentialStore.cancel()">{{ t("dangerDialog.cancel") }}</Button>
          <Button type="submit">{{ t("connectionPasswordPrompt.connect") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
