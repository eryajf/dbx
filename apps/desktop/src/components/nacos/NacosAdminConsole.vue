<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { CheckCircle2, FileText, Loader2, Network, Plus, RefreshCw, Send, Server, Trash2 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";
import * as api from "@/lib/api";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safeStorage";
import type { NacosConfigItem, NacosConfigKey, NacosConnectionInfo, NacosInstanceInfo, NacosRawResponse, NacosServiceInfo } from "@/types/nacos";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";

const props = defineProps<{
  connectionId: string;
  namespace?: string;
  namespaceName?: string;
  readOnly?: boolean;
}>();

type AdminTab = "configs" | "services" | "raw";

const { toast } = useToast();
const { t } = useI18n();
const activeTab = ref<AdminTab>("configs");
const connectionInfo = ref<NacosConnectionInfo | null>(null);
const connectionError = ref("");
const infoLoading = ref(false);

const configLoading = ref(false);
const configError = ref("");
const configGroup = ref("");
const configDataId = ref("");
const configPageNo = ref(1);
const configPageSize = ref(20);
const configs = ref<NacosConfigItem[]>([]);
const configTotal = ref(0);
const selectedConfig = ref<NacosConfigItem | null>(null);
const selectedConfigOriginalKey = ref<NacosConfigKey | null>(null);
const configContent = ref("");
const configType = ref("text");
const savingConfig = ref(false);
const deletingConfig = ref(false);
const configAdvancedOpen = ref(false);
const configSaveNotice = ref("");
const configFormatOptions = ["text", "json", "xml", "yaml", "html", "properties", "toml"];

const servicesLoading = ref(false);
const servicesError = ref("");
const serviceGroup = ref("");
const serviceName = ref("");
const servicePageNo = ref(1);
const servicePageSize = ref(20);
const services = ref<NacosServiceInfo[]>([]);
const serviceTotal = ref(0);
const selectedService = ref<NacosServiceInfo | null>(null);
const instances = ref<NacosInstanceInfo[]>([]);
const instancesLoading = ref(false);
const instancesError = ref("");

const rawMethod = ref("GET");
const rawPath = ref("/v3/console/server/state");
const rawQueryText = ref("");
const rawBodyText = ref("");
const rawLoading = ref(false);
const rawError = ref("");
const rawResponse = ref<NacosRawResponse | null>(null);
const NACOS_SPLIT_SIZE_KEY = "dbx-nacos-admin-split-size";
const savedNacosSplitSize = Number(safeLocalStorageGet(NACOS_SPLIT_SIZE_KEY));
const nacosSplitSize = ref(savedNacosSplitSize >= 20 && savedNacosSplitSize <= 80 ? savedNacosSplitSize : 42);
const CONNECTION_NOT_FOUND_RETRY_DELAYS_MS = [150, 350, 700];

const namespace = computed(() => props.namespace ?? connectionInfo.value?.namespace ?? "");
const namespaceLabel = computed(() => props.namespaceName || namespace.value || "public");
const namespaceIdLabel = computed(() => {
  if (!namespace.value || namespace.value === namespaceLabel.value) return "";
  return namespace.value;
});
const configTotalPages = computed(() => Math.max(1, Math.ceil(configTotal.value / Math.max(1, configPageSize.value))));
const serviceTotalPages = computed(() => Math.max(1, Math.ceil(serviceTotal.value / Math.max(1, servicePageSize.value))));
const isCreatingConfig = computed(() => !!selectedConfig.value && !selectedConfigOriginalKey.value);
const selectedConfigKey = computed<NacosConfigKey | null>(() => {
  if (selectedConfigOriginalKey.value) return selectedConfigOriginalKey.value;
  if (!selectedConfig.value) return null;
  return {
    namespace: selectedConfig.value.namespace || namespace.value || undefined,
    dataId: selectedConfig.value.dataId,
    group: selectedConfig.value.group,
  };
});

function handleNacosSplitResized(payload: { panes?: { size: number }[] }) {
  const size = payload.panes?.[0]?.size;
  if (typeof size !== "number" || size < 20 || size > 80) return;
  nacosSplitSize.value = size;
  safeLocalStorageSet(NACOS_SPLIT_SIZE_KEY, String(size));
}

function inferConfigFormat(dataId: string): string {
  const ext = dataId.trim().toLowerCase().split(".").pop() || "";
  if (ext === "yml") return "yaml";
  if (["yaml", "json", "xml", "html", "properties", "text"].includes(ext)) return ext;
  if (ext === "txt") return "text";
  return "";
}

function configFormatValue(item: Pick<NacosConfigItem, "dataId" | "configType">): string {
  return item.configType?.trim().toLowerCase() || inferConfigFormat(item.dataId);
}

function configFormatLabel(item: Pick<NacosConfigItem, "dataId" | "configType">): string {
  const value = configFormatValue(item);
  if (!value) return "-";
  if (["text", "json", "xml", "yaml", "html"].includes(value)) return value.toUpperCase();
  if (value === "properties") return "Properties";
  return value;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isConnectionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bConnection not found\b/i.test(message);
}

function isSameConfigKey(item: NacosConfigItem, key: NacosConfigKey): boolean {
  return (item.namespace || namespace.value || "") === (key.namespace || namespace.value || "") && item.dataId === key.dataId && item.group === key.group;
}

function upsertConfigInList(item: NacosConfigItem) {
  const key = {
    namespace: item.namespace || namespace.value || undefined,
    dataId: item.dataId,
    group: item.group,
  };
  const existingIndex = configs.value.findIndex((candidate) => isSameConfigKey(candidate, key));
  if (existingIndex >= 0) {
    configs.value.splice(existingIndex, 1, { ...configs.value[existingIndex], ...item });
    return;
  }
  configs.value = [item, ...configs.value];
  configTotal.value = Math.max(configTotal.value, configs.value.length);
}

async function loadInfo() {
  infoLoading.value = true;
  connectionError.value = "";
  try {
    connectionInfo.value = await api.nacosTestConnection(props.connectionId);
  } catch (error) {
    connectionError.value = error instanceof Error ? error.message : String(error);
  } finally {
    infoLoading.value = false;
  }
}

async function loadConfigs(page = configPageNo.value) {
  configLoading.value = true;
  configError.value = "";
  configPageNo.value = page;
  try {
    const result = await api.nacosListConfigs(props.connectionId, {
      namespace: namespace.value || undefined,
      group: configGroup.value.trim() || undefined,
      dataId: configDataId.value.trim() || undefined,
      pageNo: configPageNo.value,
      pageSize: configPageSize.value,
    });
    configs.value = result.items;
    configTotal.value = result.totalCount;
  } catch (error) {
    configError.value = error instanceof Error ? error.message : String(error);
  } finally {
    configLoading.value = false;
  }
}

async function loadConfigsWithRetry(page = configPageNo.value) {
  for (let attempt = 0; ; attempt += 1) {
    await loadConfigs(page);
    if (!isConnectionNotFoundError(configError.value) || attempt >= CONNECTION_NOT_FOUND_RETRY_DELAYS_MS.length) return;
    await delay(CONNECTION_NOT_FOUND_RETRY_DELAYS_MS[attempt]);
  }
}

async function selectConfig(item: NacosConfigItem) {
  configSaveNotice.value = "";
  selectedConfigOriginalKey.value = {
    namespace: item.namespace || namespace.value || undefined,
    dataId: item.dataId,
    group: item.group,
  };
  selectedConfig.value = item;
  configContent.value = item.content || "";
  configType.value = configFormatValue(item) || "text";
  try {
    const detail = await api.nacosGetConfig(props.connectionId, {
      namespace: item.namespace || namespace.value || undefined,
      dataId: item.dataId,
      group: item.group,
    });
    selectedConfig.value = detail;
    selectedConfigOriginalKey.value = {
      namespace: detail.namespace || item.namespace || namespace.value || undefined,
      dataId: detail.dataId || item.dataId,
      group: detail.group || item.group,
    };
    configContent.value = detail.content || "";
    configType.value = detail.configType || configFormatValue(item) || "text";
  } catch (error) {
    configError.value = error instanceof Error ? error.message : String(error);
  }
}

function newConfig() {
  configSaveNotice.value = "";
  selectedConfigOriginalKey.value = null;
  selectedConfig.value = {
    namespace: namespace.value,
    dataId: configDataId.value.trim(),
    group: configGroup.value.trim() || "DEFAULT_GROUP",
    configType: inferConfigFormat(configDataId.value) || "text",
    content: "",
    appName: "",
    desc: "",
    tags: "",
  };
  configContent.value = "";
  configType.value = selectedConfig.value.configType || "text";
  configAdvancedOpen.value = false;
}

async function saveConfig() {
  if (!selectedConfig.value || props.readOnly) return;
  const originalKey = selectedConfigOriginalKey.value;
  const wasCreating = !originalKey;
  const dataId = selectedConfig.value.dataId.trim();
  const group = selectedConfig.value.group.trim() || "DEFAULT_GROUP";
  if (!dataId) {
    configError.value = t("nacos.dataIdRequired");
    return;
  }
  savingConfig.value = true;
  configError.value = "";
  configSaveNotice.value = "";
  try {
    const configTypeForSave = originalKey ? selectedConfig.value.configType || configType.value : configType.value;
    await api.nacosPublishConfig(props.connectionId, {
      namespace: originalKey?.namespace || selectedConfig.value.namespace || namespace.value || undefined,
      dataId,
      group,
      content: configContent.value,
      configType: configTypeForSave || undefined,
      appName: selectedConfig.value.appName,
      desc: selectedConfig.value.desc,
      tags: selectedConfig.value.tags,
    });
    const savedConfig = { ...selectedConfig.value, dataId, group, content: configContent.value, configType: configType.value };
    selectedConfig.value = savedConfig;
    selectedConfigOriginalKey.value = {
      namespace: savedConfig.namespace || namespace.value || undefined,
      dataId,
      group,
    };
    configAdvancedOpen.value = false;
    configSaveNotice.value = t(wasCreating ? "nacos.createdAndLoaded" : "nacos.savedAndLoaded", { dataId });
    toast(t("nacos.saved"), 2000);
    await loadConfigsWithRetry(wasCreating ? 1 : configPageNo.value);
    upsertConfigInList(savedConfig);
  } catch (error) {
    configError.value = error instanceof Error ? error.message : String(error);
  } finally {
    savingConfig.value = false;
  }
}

async function deleteConfig() {
  const key = selectedConfigKey.value;
  if (!key || props.readOnly) return;
  deletingConfig.value = true;
  configError.value = "";
  configSaveNotice.value = "";
  try {
    await api.nacosDeleteConfig(props.connectionId, key);
    selectedConfig.value = null;
    selectedConfigOriginalKey.value = null;
    configContent.value = "";
    await loadConfigs();
    toast(t("nacos.deleted"), 2000);
  } catch (error) {
    configError.value = error instanceof Error ? error.message : String(error);
  } finally {
    deletingConfig.value = false;
  }
}

async function loadServices(page = servicePageNo.value) {
  servicesLoading.value = true;
  servicesError.value = "";
  servicePageNo.value = page;
  try {
    const result = await api.nacosListServices(props.connectionId, {
      namespace: namespace.value || undefined,
      groupName: serviceGroup.value.trim() || undefined,
      serviceName: serviceName.value.trim() || undefined,
      pageNo: servicePageNo.value,
      pageSize: servicePageSize.value,
    });
    services.value = result.items;
    serviceTotal.value = result.totalCount;
  } catch (error) {
    servicesError.value = error instanceof Error ? error.message : String(error);
  } finally {
    servicesLoading.value = false;
  }
}

async function loadServicesWithRetry(page = servicePageNo.value) {
  for (let attempt = 0; ; attempt += 1) {
    await loadServices(page);
    if (!isConnectionNotFoundError(servicesError.value) || attempt >= CONNECTION_NOT_FOUND_RETRY_DELAYS_MS.length) return;
    await delay(CONNECTION_NOT_FOUND_RETRY_DELAYS_MS[attempt]);
  }
}

async function selectService(service: NacosServiceInfo) {
  selectedService.value = service;
  await loadInstances();
}

async function loadInstances() {
  if (!selectedService.value) return;
  instancesLoading.value = true;
  instancesError.value = "";
  try {
    instances.value = await api.nacosListInstances(props.connectionId, {
      namespace: namespace.value || undefined,
      serviceName: selectedService.value.serviceName,
      groupName: selectedService.value.groupName || serviceGroup.value || undefined,
    });
  } catch (error) {
    instancesError.value = error instanceof Error ? error.message : String(error);
  } finally {
    instancesLoading.value = false;
  }
}

async function updateInstance(instance: NacosInstanceInfo, patch: Partial<NacosInstanceInfo>) {
  if (!selectedService.value || props.readOnly) return;
  try {
    await api.nacosUpdateInstance(props.connectionId, {
      namespace: namespace.value || undefined,
      serviceName: selectedService.value.serviceName,
      groupName: instance.groupName || selectedService.value.groupName || serviceGroup.value || undefined,
      clusterName: instance.clusterName,
      ip: instance.ip,
      port: instance.port,
      healthy: patch.healthy ?? instance.healthy,
      enabled: patch.enabled ?? instance.enabled,
      ephemeral: patch.ephemeral ?? instance.ephemeral,
      weight: patch.weight ?? instance.weight,
      metadata: instance.metadata,
    });
    await loadInstances();
  } catch (error) {
    instancesError.value = error instanceof Error ? error.message : String(error);
  }
}

function parseRawQuery(): Record<string, string> | undefined {
  const text = rawQueryText.value.trim();
  if (!text) return undefined;
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

function parseRawBody(): unknown {
  const text = rawBodyText.value.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sendRaw() {
  rawLoading.value = true;
  rawError.value = "";
  rawResponse.value = null;
  try {
    rawResponse.value = await api.nacosRawRequest(props.connectionId, {
      method: rawMethod.value,
      path: rawPath.value.trim(),
      query: parseRawQuery(),
      body: parseRawBody(),
    });
  } catch (error) {
    rawError.value = error instanceof Error ? error.message : String(error);
  } finally {
    rawLoading.value = false;
  }
}

watch(
  () => [props.connectionId, props.namespace] as const,
  async () => {
    selectedConfig.value = null;
    selectedConfigOriginalKey.value = null;
    selectedService.value = null;
    await loadInfo();
    await Promise.all([loadConfigsWithRetry(1), loadServicesWithRetry(1)]);
  },
);

onMounted(async () => {
  await loadInfo();
  await Promise.all([loadConfigsWithRetry(1), loadServicesWithRetry(1)]);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
      <div class="flex min-w-0 items-center gap-2 text-sm">
        <Network class="h-4 w-4 text-sky-600" />
        <span class="truncate font-medium">{{ connectionInfo?.serverAddr || "Nacos" }}</span>
        <Badge v-if="connectionInfo?.serverVersion" variant="secondary">{{ connectionInfo.serverVersion }}</Badge>
        <Badge variant="outline">{{ namespaceLabel }}</Badge>
        <Badge v-if="namespaceIdLabel" variant="outline" class="max-w-72 truncate font-mono">{{ namespaceIdLabel }}</Badge>
        <Badge v-if="readOnly" variant="outline">{{ t("nacos.readOnly") }}</Badge>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="connectionError" class="max-w-96 truncate text-xs text-destructive">{{ connectionError }}</span>
        <Button size="sm" variant="outline" class="h-8 gap-1.5" :disabled="infoLoading" @click="loadInfo">
          <Loader2 v-if="infoLoading" class="h-3.5 w-3.5 animate-spin" />
          <RefreshCw v-else class="h-3.5 w-3.5" />
          {{ t("nacos.test") }}
        </Button>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
      <button class="rounded px-3 py-1.5 text-sm" :class="activeTab === 'configs' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60'" @click="activeTab = 'configs'">{{ t("nacos.configs") }}</button>
      <button class="rounded px-3 py-1.5 text-sm" :class="activeTab === 'services' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60'" @click="activeTab = 'services'">{{ t("nacos.services") }}</button>
      <button class="rounded px-3 py-1.5 text-sm" :class="activeTab === 'raw' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60'" @click="activeTab = 'raw'">{{ t("nacos.raw") }}</button>
    </div>

    <Splitpanes v-if="activeTab === 'configs'" class="nacos-admin-splitpanes min-h-0 flex-1" @resized="handleNacosSplitResized">
      <Pane :size="nacosSplitSize" min-size="24">
        <div class="flex h-full min-h-0 flex-col">
          <div class="grid shrink-0 grid-cols-[minmax(160px,1fr)_130px_auto] gap-2 border-b p-2">
            <Input v-model="configDataId" class="h-8" placeholder="dataId" @keyup.enter="loadConfigsWithRetry(1)" />
            <Input v-model="configGroup" class="h-8" :placeholder="t('nacos.allGroups')" @keyup.enter="loadConfigsWithRetry(1)" />
            <div class="flex gap-2">
              <Button size="sm" variant="outline" class="h-8 flex-1 gap-1.5" :disabled="configLoading" @click="loadConfigsWithRetry(1)">
                <Loader2 v-if="configLoading" class="h-3.5 w-3.5 animate-spin" />
                <RefreshCw v-else class="h-3.5 w-3.5" />
                {{ t("nacos.load") }}
              </Button>
              <Button size="sm" class="h-8" :disabled="readOnly" @click="newConfig">
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div v-if="configError" class="border-b px-3 py-2 text-xs text-destructive">{{ configError }}</div>
          <div class="min-h-0 flex-1 overflow-auto">
            <div class="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_128px_84px] border-b bg-muted/70 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>dataID</span>
              <span>{{ t("nacos.group") }}</span>
              <span>{{ t("nacos.format") }}</span>
            </div>
            <button
              v-for="item in configs"
              :key="`${item.namespace}:${item.group}:${item.dataId}`"
              type="button"
              class="grid w-full grid-cols-[minmax(0,1fr)_128px_84px] items-center border-b px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
              :class="{ 'bg-accent': selectedConfig?.dataId === item.dataId && selectedConfig?.group === item.group }"
              @click="selectConfig(item)"
            >
              <span class="flex min-w-0 items-center gap-2 pr-3" :title="item.dataId">
                <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate font-medium text-foreground">{{ item.dataId }}</span>
              </span>
              <span class="truncate pr-3 text-xs text-muted-foreground" :title="item.group || 'DEFAULT_GROUP'">{{ item.group || "DEFAULT_GROUP" }}</span>
              <span class="truncate text-xs text-muted-foreground" :title="configFormatLabel(item)">{{ configFormatLabel(item) }}</span>
            </button>
            <div v-if="!configLoading && configs.length === 0" class="flex h-full items-center justify-center text-sm text-muted-foreground">{{ t("nacos.noConfigs") }}</div>
          </div>
          <div class="flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>{{ t("nacos.total", { count: configTotal }) }}</span>
            <div class="flex items-center gap-2">
              <Button size="sm" variant="outline" class="h-7" :disabled="configPageNo <= 1 || configLoading" @click="loadConfigs(configPageNo - 1)">{{ t("nacos.prev") }}</Button>
              <span>{{ configPageNo }} / {{ configTotalPages }}</span>
              <Button size="sm" variant="outline" class="h-7" :disabled="configPageNo >= configTotalPages || configLoading" @click="loadConfigs(configPageNo + 1)">{{ t("nacos.next") }}</Button>
            </div>
          </div>
        </div>
      </Pane>

      <Pane :size="100 - nacosSplitSize" min-size="20">
        <div class="flex h-full min-h-0 flex-col">
          <div v-if="selectedConfig" class="shrink-0 border-b p-3">
            <div class="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <Label class="text-right text-xs text-muted-foreground">{{ t("nacos.namespace") }}</Label>
              <div class="truncate text-sm font-medium">{{ namespaceLabel }}</div>

              <Label class="text-right text-xs">
                <span class="text-destructive">*</span>
                {{ t("nacos.dataId") }}
              </Label>
              <Input v-model="selectedConfig.dataId" class="h-8" :readonly="!isCreatingConfig" :class="{ 'bg-muted text-muted-foreground': !isCreatingConfig }" @input="configSaveNotice = ''" />

              <Label class="text-right text-xs">
                <span class="text-destructive">*</span>
                {{ t("nacos.group") }}
              </Label>
              <Input v-model="selectedConfig.group" class="h-8" :readonly="!isCreatingConfig" :class="{ 'bg-muted text-muted-foreground': !isCreatingConfig }" @input="configSaveNotice = ''" />

              <span />
              <button type="button" class="w-fit text-xs font-medium text-primary hover:underline" @click="configAdvancedOpen = !configAdvancedOpen">
                {{ configAdvancedOpen ? t("nacos.collapse") : t("nacos.advanced") }}
              </button>

              <template v-if="configAdvancedOpen">
                <Label class="text-right text-xs text-muted-foreground">{{ t("nacos.tags") }}</Label>
                <Input v-model="selectedConfig.tags" class="h-8" placeholder="tag1,tag2" @input="configSaveNotice = ''" />

                <Label class="text-right text-xs text-muted-foreground">{{ t("nacos.application") }}</Label>
                <Input v-model="selectedConfig.appName" class="h-8" @input="configSaveNotice = ''" />

                <Label class="text-right text-xs text-muted-foreground">{{ t("nacos.description") }}</Label>
                <Input v-model="selectedConfig.desc" class="h-8" @input="configSaveNotice = ''" />
              </template>

              <Label class="text-right text-xs">
                <span class="text-destructive">*</span>
                {{ t("nacos.format") }}
              </Label>
              <div class="flex min-w-0 flex-wrap gap-2">
                <button
                  v-for="format in configFormatOptions"
                  :key="format"
                  type="button"
                  class="rounded-md border px-2.5 py-1 text-xs font-medium uppercase transition-colors"
                  :class="configType === format ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-accent'"
                  @click="
                    configType = format;
                    configSaveNotice = '';
                  "
                >
                  {{ format }}
                </button>
              </div>
            </div>
            <div class="mt-3 flex items-center justify-between gap-3">
              <div v-if="configSaveNotice" class="flex min-w-0 items-center gap-1.5 text-xs text-emerald-600">
                <CheckCircle2 class="h-3.5 w-3.5 shrink-0" />
                <span class="truncate">{{ configSaveNotice }}</span>
              </div>
              <span v-else />
              <div class="flex shrink-0 gap-2">
                <Button size="sm" class="h-8 gap-1.5" :disabled="readOnly || savingConfig" @click="saveConfig">
                  <Loader2 v-if="savingConfig" class="h-3.5 w-3.5 animate-spin" />
                  <Send v-else class="h-3.5 w-3.5" />
                  {{ savingConfig ? t("nacos.saving") : t("nacos.save") }}
                </Button>
                <Button size="sm" variant="outline" class="h-8" :disabled="readOnly || deletingConfig" @click="deleteConfig">
                  <Loader2 v-if="deletingConfig" class="h-3.5 w-3.5 animate-spin" />
                  <Trash2 v-else class="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <textarea v-if="selectedConfig" v-model="configContent" class="min-h-0 flex-1 resize-none border-0 bg-background p-3 font-mono text-sm outline-none focus-visible:ring-0" spellcheck="false" @input="configSaveNotice = ''" />
          <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">{{ t("nacos.selectConfig") }}</div>
        </div>
      </Pane>
    </Splitpanes>

    <Splitpanes v-else-if="activeTab === 'services'" class="nacos-admin-splitpanes min-h-0 flex-1" @resized="handleNacosSplitResized">
      <Pane :size="nacosSplitSize" min-size="24">
        <div class="flex h-full min-h-0 flex-col">
          <div class="grid shrink-0 grid-cols-[1fr_130px_auto] gap-2 border-b p-2">
            <Input v-model="serviceName" class="h-8" :placeholder="t('nacos.service')" @keyup.enter="loadServicesWithRetry(1)" />
            <Input v-model="serviceGroup" class="h-8" :placeholder="t('nacos.allGroups')" @keyup.enter="loadServicesWithRetry(1)" />
            <Button size="sm" variant="outline" class="h-8 gap-1.5" :disabled="servicesLoading" @click="loadServicesWithRetry(1)">
              <Loader2 v-if="servicesLoading" class="h-3.5 w-3.5 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" />
              {{ t("nacos.load") }}
            </Button>
          </div>
          <div v-if="servicesError" class="border-b px-3 py-2 text-xs text-destructive">{{ servicesError }}</div>
          <div class="min-h-0 flex-1 overflow-auto">
            <button
              v-for="service in services"
              :key="`${service.groupName}:${service.serviceName}`"
              type="button"
              class="grid w-full gap-1 border-b px-3 py-2 text-left text-sm hover:bg-accent/60"
              :class="{ 'bg-accent': selectedService?.serviceName === service.serviceName && selectedService?.groupName === service.groupName }"
              @click="selectService(service)"
            >
              <span class="truncate font-medium">{{ service.serviceName }}</span>
              <span class="flex items-center gap-2 text-xs text-muted-foreground">
                <Server class="h-3.5 w-3.5" />
                {{ service.groupName || serviceGroup }}
                <span v-if="service.ipCount != null">· {{ t("nacos.instanceCount", { count: service.ipCount }) }}</span>
              </span>
            </button>
            <div v-if="!servicesLoading && services.length === 0" class="flex h-full items-center justify-center text-sm text-muted-foreground">{{ t("nacos.noServices") }}</div>
          </div>
          <div class="flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>{{ t("nacos.total", { count: serviceTotal }) }}</span>
            <div class="flex items-center gap-2">
              <Button size="sm" variant="outline" class="h-7" :disabled="servicePageNo <= 1 || servicesLoading" @click="loadServices(servicePageNo - 1)">{{ t("nacos.prev") }}</Button>
              <span>{{ servicePageNo }} / {{ serviceTotalPages }}</span>
              <Button size="sm" variant="outline" class="h-7" :disabled="servicePageNo >= serviceTotalPages || servicesLoading" @click="loadServices(servicePageNo + 1)">{{ t("nacos.next") }}</Button>
            </div>
          </div>
        </div>
      </Pane>

      <Pane :size="100 - nacosSplitSize" min-size="20">
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex shrink-0 items-center justify-between border-b px-3 py-2">
            <div class="truncate text-sm font-medium">{{ selectedService?.serviceName || t("nacos.instances") }}</div>
            <Button size="sm" variant="outline" class="h-8 gap-1.5" :disabled="!selectedService || instancesLoading" @click="loadInstances">
              <Loader2 v-if="instancesLoading" class="h-3.5 w-3.5 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" />
              {{ t("nacos.refresh") }}
            </Button>
          </div>
          <div v-if="instancesError" class="border-b px-3 py-2 text-xs text-destructive">{{ instancesError }}</div>
          <div class="min-h-0 flex-1 overflow-auto">
            <table v-if="instances.length" class="w-full text-left text-sm">
              <thead class="sticky top-0 bg-muted/80 text-xs text-muted-foreground">
                <tr>
                  <th class="px-3 py-2 font-medium">{{ t("nacos.address") }}</th>
                  <th class="px-3 py-2 font-medium">{{ t("nacos.cluster") }}</th>
                  <th class="px-3 py-2 font-medium">{{ t("nacos.weight") }}</th>
                  <th class="px-3 py-2 font-medium">{{ t("nacos.state") }}</th>
                  <th class="px-3 py-2 text-right font-medium">{{ t("nacos.actions") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="instance in instances" :key="`${instance.ip}:${instance.port}`" class="border-b">
                  <td class="px-3 py-2 font-mono text-xs">{{ instance.ip }}:{{ instance.port }}</td>
                  <td class="px-3 py-2">{{ instance.clusterName || "-" }}</td>
                  <td class="px-3 py-2">{{ instance.weight ?? "-" }}</td>
                  <td class="px-3 py-2">
                    <div class="flex flex-wrap gap-1">
                      <Badge :variant="instance.healthy === false ? 'outline' : 'secondary'">{{ instance.healthy === false ? t("nacos.unhealthy") : t("nacos.healthy") }}</Badge>
                      <Badge :variant="instance.enabled === false ? 'outline' : 'secondary'">{{ instance.enabled === false ? t("nacos.offline") : t("nacos.enabled") }}</Badge>
                      <Badge v-if="instance.ephemeral != null" variant="outline">{{ instance.ephemeral ? t("nacos.ephemeral") : t("nacos.persistent") }}</Badge>
                    </div>
                  </td>
                  <td class="px-3 py-2 text-right">
                    <div class="inline-flex gap-2">
                      <Button size="sm" variant="outline" class="h-7" :disabled="readOnly" @click="updateInstance(instance, { enabled: !instance.enabled })">
                        {{ instance.enabled === false ? t("nacos.enable") : t("nacos.disable") }}
                      </Button>
                      <Button size="sm" variant="outline" class="h-7" :disabled="readOnly" @click="updateInstance(instance, { healthy: !instance.healthy })">
                        {{ instance.healthy === false ? t("nacos.markHealthy") : t("nacos.markUnhealthy") }}
                      </Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">{{ t("nacos.selectService") }}</div>
          </div>
        </div>
      </Pane>
    </Splitpanes>

    <Splitpanes v-else class="nacos-admin-splitpanes min-h-0 flex-1" @resized="handleNacosSplitResized">
      <Pane :size="nacosSplitSize" min-size="24">
        <div class="flex h-full min-h-0 flex-col gap-3 p-3">
          <div class="grid grid-cols-[120px_1fr] gap-2">
            <Select v-model="rawMethod">
              <SelectTrigger class="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
            <Input v-model="rawPath" class="h-8" placeholder="/v3/console/server/state" />
          </div>
          <div>
            <Label class="text-xs">{{ t("nacos.query") }}</Label>
            <Input v-model="rawQueryText" class="h-8" placeholder="dataId=a&group=DEFAULT_GROUP" />
          </div>
          <div class="flex min-h-0 flex-1 flex-col">
            <Label class="text-xs">{{ t("nacos.body") }}</Label>
            <textarea v-model="rawBodyText" class="min-h-0 flex-1 resize-none rounded-md border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring" spellcheck="false" />
          </div>
          <Button size="sm" class="h-8 gap-1.5" :disabled="rawLoading || (readOnly && rawMethod !== 'GET')" @click="sendRaw">
            <Loader2 v-if="rawLoading" class="h-3.5 w-3.5 animate-spin" />
            <Send v-else class="h-3.5 w-3.5" />
            {{ t("nacos.send") }}
          </Button>
        </div>
      </Pane>
      <Pane :size="100 - nacosSplitSize" min-size="20">
        <div class="flex h-full min-h-0 flex-col">
          <div class="shrink-0 border-b px-3 py-2 text-sm font-medium">{{ t("nacos.response") }}</div>
          <div v-if="rawError" class="border-b px-3 py-2 text-xs text-destructive">{{ rawError }}</div>
          <pre class="min-h-0 flex-1 overflow-auto p-3 text-xs">{{ rawResponse ? JSON.stringify(rawResponse, null, 2) : "" }}</pre>
        </div>
      </Pane>
    </Splitpanes>
  </div>
</template>

<style scoped>
.nacos-admin-splitpanes :deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 4px !important;
  border-left: 1px solid var(--border);
  background: transparent;
  cursor: col-resize;
}

.nacos-admin-splitpanes :deep(.splitpanes__splitter:hover) {
  background: oklch(0.6 0.15 250) !important;
}
</style>
