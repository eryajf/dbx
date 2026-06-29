<script setup lang="ts">
import { computed, ref } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import { X } from "@lucide/vue";
import QueryEditor from "@/components/editor/QueryEditor.vue";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQueryStore } from "@/stores/queryStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { effectiveDatabaseTypeForConnection } from "@/lib/jdbcDialect";
import { sqlFormatDialectForDbType } from "@/lib/sqlFormatter";
import type { QueryPaneLayoutNode } from "@/lib/queryPaneLayout";
import type { QueryTab } from "@/types/database";
import type { SqlExecutionOverride } from "@/lib/sqlExecutionTarget";

type QueryPaneLayoutHandle = {
  tabId?: string;
  openSearch: () => boolean;
  openReplace: () => boolean;
  requestExecute: () => boolean;
};

const props = defineProps<{
  node: QueryPaneLayoutNode;
  activePaneTabId: string | null;
  canClosePanes?: boolean;
  formatSqlRequest: { id: number; tabId: string } | null;
  executionErrorsByTabId?: Record<string, string>;
}>();

const emit = defineEmits<{
  execute: [tab: QueryTab, sqlOverride?: SqlExecutionOverride];
  saveSql: [];
  editorUpdate: [tabId: string, value: string];
  editorSelectionChange: [tabId: string, value: string];
  editorCursorChange: [tabId: string, pos: number];
  editorViewportChange: [tabId: string, viewport: { scrollTop: number; scrollLeft: number }];
  editorSelectionStateChange: [tabId: string, selection: { anchor: number; head: number }];
  formatError: [];
  clickTable: [tableName: string];
  viewTableData: [tableName: string];
  viewTableDdl: [tableName: string];
  clickColumn: [tabId: string, columns: Array<{ name: string; table: string; schema?: string }>, error?: string | undefined];
  closeColumnPanel: [];
  activateTab: [tabId: string];
}>();

const queryStore = useQueryStore();
const connectionStore = useConnectionStore();
const queryEditorRef = ref<InstanceType<typeof QueryEditor>>();
const childRefs: Array<QueryPaneLayoutHandle | null> = [];

const tab = computed(() => {
  const node = props.node;
  return node.type === "leaf" ? queryStore.tabs.find((item) => item.id === node.tabId) : undefined;
});
const connection = computed(() => (tab.value ? connectionStore.getConfig(tab.value.connectionId) : undefined));
const effectiveDatabaseType = computed(() => effectiveDatabaseTypeForConnection(connection.value));
const editorDialect = computed<"mysql" | "postgres" | "sqlserver">(() => {
  if (effectiveDatabaseType.value === "postgres" || effectiveDatabaseType.value === "kwdb") return "postgres";
  if (effectiveDatabaseType.value === "sqlserver") return "sqlserver";
  return "mysql";
});
const formatDialect = computed(() => sqlFormatDialectForDbType(effectiveDatabaseType.value));

function onResized(event: unknown) {
  if (props.node.type !== "split") return;
  const panes = typeof event === "object" && event !== null && Array.isArray((event as { panes?: unknown }).panes) ? (event as { panes: Array<{ size?: number }> }).panes : [];
  if (panes.length !== props.node.children.length) return;
  const sizes = panes.map((item) => item.size);
  if (sizes.some((size) => typeof size !== "number" || !Number.isFinite(size) || size <= 0)) return;
  queryStore.resizeQueryPane(props.node.id, sizes as number[]);
}

function onClickColumn(tabId: string, columns: Array<{ name: string; table: string; schema?: string }>, error?: string | undefined) {
  emit("clickColumn", tabId, columns, error);
}

function closeColumnInfo() {
  emit("closeColumnPanel");
}

function childHandles() {
  return childRefs.filter((child): child is QueryPaneLayoutHandle => !!child);
}

function activeChildHandle() {
  return childHandles().find((child) => child.tabId === props.activePaneTabId);
}

function openSearch() {
  if (tab.value?.id === props.activePaneTabId && queryEditorRef.value?.openSearch()) return true;
  return activeChildHandle()?.openSearch() ?? false;
}

function openReplace() {
  if (tab.value?.id === props.activePaneTabId && queryEditorRef.value?.openReplace()) return true;
  return activeChildHandle()?.openReplace() ?? false;
}

function requestExecute() {
  if (tab.value?.id === props.activePaneTabId && queryEditorRef.value?.requestExecute()) return true;
  return activeChildHandle()?.requestExecute() ?? false;
}

function setChildRef(index: number, el: QueryPaneLayoutHandle | null) {
  childRefs[index] = el;
}

function closePane(tabId: string) {
  queryStore.closeQueryPane(tabId);
}

defineExpose({ tabId: computed(() => (props.node.type === "leaf" ? props.node.tabId : undefined)), openSearch, openReplace, requestExecute });
</script>

<template>
  <div v-if="node.type === 'leaf' && tab" class="group/query-pane relative flex min-h-0 flex-1 flex-col" @focusin="emit('activateTab', tab.id)">
    <Tooltip v-if="canClosePanes">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="absolute right-2 top-2 z-30 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/query-pane:opacity-100"
          :aria-label="$t('toolbar.closeQueryPane')"
          @pointerdown.prevent.stop="closePane(tab.id)"
          @click.prevent.stop
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ $t("toolbar.closeQueryPane") }}</TooltipContent>
    </Tooltip>
    <QueryEditor
      ref="queryEditorRef"
      class="flex-1"
      :model-value="tab.sql"
      :connection-id="tab.connectionId"
      :database="tab.database"
      :schema="tab.schema"
      :database-type="effectiveDatabaseType"
      :dialect="editorDialect"
      :format-dialect="formatDialect"
      :format-request-id="formatSqlRequest?.tabId === tab.id ? formatSqlRequest.id : undefined"
      :execution-error="executionErrorsByTabId?.[tab.id]"
      :execution-error-sql="tab.lastExecutedSql"
      :auto-focus="tab.id === activePaneTabId"
      :initial-viewport="tab.editorViewport"
      :initial-selection="tab.editorSelection"
      @update:model-value="emit('editorUpdate', tab.id, $event)"
      @selection-change="emit('editorSelectionChange', tab.id, $event)"
      @cursor-change="emit('editorCursorChange', tab.id, $event)"
      @viewport-change="emit('editorViewportChange', tab.id, $event)"
      @selection-state-change="emit('editorSelectionStateChange', tab.id, $event)"
      @format-error="emit('formatError')"
      @execute="emit('execute', tab, $event)"
      @save="emit('saveSql')"
      @click-table="emit('clickTable', $event)"
      @view-table-data="emit('viewTableData', $event)"
      @view-table-ddl="emit('viewTableDdl', $event)"
      @click-column="(columns, error) => onClickColumn(tab!.id, columns, error)"
      @close-column-panel="closeColumnInfo"
    />
  </div>
  <Splitpanes v-else-if="node.type === 'split'" class="query-pane-layout flex-1 min-h-0 overflow-hidden" :horizontal="node.direction === 'horizontal'" @resized="onResized">
    <Pane v-for="(child, index) in node.children" :key="child.id" class="min-h-0" :size="node.sizes?.[index]" :min-size="8">
      <QueryPaneLayout
        :ref="(el) => setChildRef(index, el as QueryPaneLayoutHandle | null)"
        :node="child"
        :active-pane-tab-id="activePaneTabId"
        :can-close-panes="canClosePanes"
        :format-sql-request="formatSqlRequest"
        :execution-errors-by-tab-id="executionErrorsByTabId"
        @execute="(tab, sqlOverride) => emit('execute', tab, sqlOverride)"
        @save-sql="emit('saveSql')"
        @editor-update="(tabId, value) => emit('editorUpdate', tabId, value)"
        @editor-selection-change="(tabId, value) => emit('editorSelectionChange', tabId, value)"
        @editor-cursor-change="(tabId, pos) => emit('editorCursorChange', tabId, pos)"
        @editor-viewport-change="(tabId, viewport) => emit('editorViewportChange', tabId, viewport)"
        @editor-selection-state-change="(tabId, selection) => emit('editorSelectionStateChange', tabId, selection)"
        @format-error="emit('formatError')"
        @click-table="emit('clickTable', $event)"
        @view-table-data="emit('viewTableData', $event)"
        @view-table-ddl="emit('viewTableDdl', $event)"
        @click-column="(tabId, columns, error) => emit('clickColumn', tabId, columns, error)"
        @close-column-panel="emit('closeColumnPanel')"
        @activate-tab="emit('activateTab', $event)"
      />
    </Pane>
  </Splitpanes>
</template>

<style scoped>
.query-pane-layout :deep(> .splitpanes__splitter) {
  z-index: 2;
  flex: 0 0 4px;
  background: hsl(var(--border));
}
</style>
