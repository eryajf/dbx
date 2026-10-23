<script setup lang="ts">
import { computed } from "vue";
import type { SavedSqlFile } from "@/types/database";
import { findSavedSqlSearchMatches, type SavedSqlLineMatch } from "@/lib/savedSql/savedSqlSearch";
import SqlSearchSnippets from "./SqlSearchSnippets.vue";

const props = withDefaults(
  defineProps<{
    file: SavedSqlFile;
    query: string;
    depth?: number;
  }>(),
  {
    depth: 0,
  },
);

const emit = defineEmits<{
  selectMatch: [match: SavedSqlLineMatch];
}>();

const searchResult = computed(() => findSavedSqlSearchMatches(props.file.sql, props.query, { maxMatches: 100 }));
</script>

<template>
  <SqlSearchSnippets :result="searchResult" :query="query" :depth="depth" @select-match="emit('selectMatch', $event)" />
</template>
