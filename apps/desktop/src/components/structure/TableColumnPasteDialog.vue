<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { parseTableColumnDefinitions } from "@/lib/table/tableColumnDefinitionPaste";

const props = defineProps<{ open: boolean; disabled: boolean; existingNames: string[] }>();
const emit = defineEmits<{ "update:open": [open: boolean]; import: [text: string] }>();
const { t } = useI18n();
const text = ref("");
const result = computed(() => parseTableColumnDefinitions(text.value, props.existingNames));
const canImport = computed(() => !props.disabled && result.value.columns.length > 0 && !result.value.diagnostics.length);
const example = "create_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Created at',\nupdate_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Updated at'";

watch(
  () => props.open,
  () => {
    text.value = "";
  },
);

function submit() {
  if (canImport.value) emit("import", text.value);
}

function onKeydown(event: KeyboardEvent) {
  // Reka handles Escape at window level. Other keys stay inside the dialog so
  // editor shortcuts (such as Ctrl/Cmd+S) cannot save the underlying table.
  if (event.key !== "Escape") event.stopPropagation();
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex max-h-[85vh] max-w-3xl flex-col" @keydown="onKeydown">
      <DialogHeader>
        <DialogTitle>{{ t("tableColumnPaste.title") }}</DialogTitle>
        <DialogDescription>{{ t("tableColumnPaste.description") }}</DialogDescription>
      </DialogHeader>
      <div class="min-h-0 space-y-3 overflow-y-auto">
        <label class="block space-y-2 text-sm">
          <span>{{ t("tableColumnPaste.input") }}</span>
          <textarea
            v-model="text"
            :disabled="disabled"
            :placeholder="example"
            :aria-invalid="result.diagnostics.length > 0"
            spellcheck="false"
            rows="7"
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            data-column-paste-input
          />
        </label>
        <div v-for="diagnostic in result.diagnostics" :key="diagnostic.code" role="alert" class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p>{{ t("tableColumnPaste.position", { line: diagnostic.line, column: diagnostic.column }) }} · {{ t(`tableColumnPaste.${diagnostic.code}`) }}</p>
          <code v-if="diagnostic.detail" class="mt-1 block max-h-20 overflow-auto whitespace-pre-wrap break-all">{{ diagnostic.detail }}</code>
        </div>
        <div v-if="result.columns.length" class="space-y-2">
          <p class="text-sm text-muted-foreground" aria-live="polite">{{ t("tableColumnPaste.preview", { count: result.columns.length }) }}</p>
          <div class="max-h-64 overflow-auto rounded-md border">
            <table class="w-full text-left text-xs">
              <thead class="sticky top-0 bg-muted">
                <tr>
                  <th class="p-2">{{ t("structureEditor.columnName") }}</th>
                  <th class="p-2">{{ t("structureEditor.dataType") }}</th>
                  <th class="p-2">{{ t("structureEditor.nullable") }}</th>
                  <th class="p-2">{{ t("structureEditor.defaultValue") }}</th>
                  <th class="p-2">{{ t("structureEditor.comment") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="column in result.columns" :key="column.name" class="border-t align-top">
                  <td class="break-all p-2 font-mono">{{ column.name }}</td>
                  <td class="break-all p-2 font-mono">{{ column.dataType }}</td>
                  <td class="whitespace-nowrap p-2 font-mono">{{ column.isNullable ? "NULL" : "NOT NULL" }}</td>
                  <td class="break-all p-2 font-mono">
                    {{ column.defaultValue }}
                    <div v-if="column.extra.onUpdateCurrentTimestamp">ON UPDATE CURRENT_TIMESTAMP{{ column.dataType.match(/\(\s*[0-6]\s*\)/)?.[0] ?? "" }}</div>
                  </td>
                  <td class="whitespace-pre-wrap break-all p-2">{{ column.comment }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">{{ t("common.cancel") }}</Button>
        <Button :disabled="!canImport" data-column-paste-submit @click="submit">{{ t("tableColumnPaste.import", { count: result.columns.length }) }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
