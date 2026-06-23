<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { SearchQuery, setSearchQuery, openSearchPanel as cmOpenSearchPanel, findNext as cmFindNext, findPrevious as cmFindPrevious, replaceNext as cmReplaceNext, replaceAll as cmReplaceAll } from "@codemirror/search";
import { ChevronUp, ChevronDown, ChevronRight, X } from "@lucide/vue";

const props = defineProps<{
  view: EditorView | null;
}>();

const { t } = useI18n();

const searchVisible = ref(false);
const searchText = ref("");
const replaceText = ref("");
const showReplace = ref(false);
const caseSensitive = ref(false);
const useRegex = ref(false);
const matchCount = ref(0);
const currentMatchIndex = ref(0);
const searchInputRef = ref<HTMLInputElement>();
const replaceInputRef = ref<HTMLInputElement>();
const matchCountLimited = ref(false);

const SEARCH_UPDATE_DELAY_MS = 120;
const MATCH_COUNT_LIMIT = 1000;

let searchUpdateTimer: ReturnType<typeof setTimeout> | null = null;

function dispatchSearchQuery() {
  const v = props.view;
  if (!v) return;
  const q = new SearchQuery({
    search: searchText.value,
    caseSensitive: caseSensitive.value,
    regexp: useRegex.value,
    replace: replaceText.value,
  });
  v.dispatch({ effects: setSearchQuery.of(q) });
}

function clearSearchQuery() {
  const v = props.view;
  if (!v) return;
  const selection = v.state.selection.main;
  v.dispatch({
    selection: EditorSelection.single(selection.head),
    effects: setSearchQuery.of(new SearchQuery({ search: "" })),
  });
  matchCount.value = 0;
  currentMatchIndex.value = 0;
  matchCountLimited.value = false;
}

function updateMatchInfo(autoSelect = false) {
  const v = props.view;
  if (!v || !searchText.value) {
    matchCount.value = 0;
    currentMatchIndex.value = 0;
    matchCountLimited.value = false;
    return;
  }
  try {
    const q = new SearchQuery({
      search: searchText.value,
      caseSensitive: caseSensitive.value,
      regexp: useRegex.value,
    });
    if (!q.valid) {
      matchCount.value = 0;
      currentMatchIndex.value = 0;
      matchCountLimited.value = false;
      return;
    }
    if (autoSelect) {
      cmFindNext(v);
    }
    const iter = q.getCursor(v.state);
    let count = 0;
    let curIdx = 0;
    const selFrom = v.state.selection.main.from;
    const selTo = v.state.selection.main.to;
    let r = iter.next();
    while (!r.done) {
      count++;
      if (r.value.from === selFrom && r.value.to === selTo) curIdx = count;
      if (count >= MATCH_COUNT_LIMIT) break;
      r = iter.next();
    }
    matchCount.value = count;
    matchCountLimited.value = count >= MATCH_COUNT_LIMIT && !r.done;
    currentMatchIndex.value = curIdx || (count > 0 ? 1 : 0);
  } catch {
    matchCount.value = 0;
    currentMatchIndex.value = 0;
    matchCountLimited.value = false;
  }
}

function scheduleSearchUpdate(autoSelect = false) {
  if (searchUpdateTimer) {
    clearTimeout(searchUpdateTimer);
    searchUpdateTimer = null;
  }
  if (!searchText.value) {
    clearSearchQuery();
    return;
  }
  dispatchSearchQuery();
  searchUpdateTimer = setTimeout(() => {
    searchUpdateTimer = null;
    updateMatchInfo(autoSelect);
  }, SEARCH_UPDATE_DELAY_MS);
}

function openSearch(): boolean {
  searchVisible.value = true;
  const v = props.view;
  if (v) {
    cmOpenSearchPanel(v);
    const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
    if (sel && !sel.includes("\n")) searchText.value = sel;
  }
  nextTick(() => {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  });
  if (searchText.value) scheduleSearchUpdate(true);
  return true;
}

function openReplace(): boolean {
  openSearch();
  showReplace.value = true;
  nextTick(() => {
    replaceInputRef.value?.focus();
    replaceInputRef.value?.select();
  });
  return true;
}

function closeSearch() {
  const wasVisible = searchVisible.value;
  searchVisible.value = false;
  showReplace.value = false;
  const v = props.view;
  if (v) {
    clearSearchQuery();
    v.focus();
  }
  return wasVisible;
}

function nextMatch() {
  const v = props.view;
  if (!v || !searchText.value) return;
  cmFindNext(v);
  updateMatchInfo();
}

function prevMatch() {
  const v = props.view;
  if (!v || !searchText.value) return;
  cmFindPrevious(v);
  updateMatchInfo();
}

function doReplace() {
  const v = props.view;
  if (!v || !searchText.value) return;
  cmReplaceNext(v);
  updateMatchInfo();
}

function doReplaceAll() {
  const v = props.view;
  if (!v || !searchText.value) return;
  cmReplaceAll(v);
  updateMatchInfo();
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
  } else if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    nextMatch();
  } else if (e.key === "Enter" && e.shiftKey) {
    e.preventDefault();
    prevMatch();
  }
}

watch([searchText, caseSensitive, useRegex], () => {
  if (searchVisible.value) scheduleSearchUpdate(true);
});

watch(replaceText, () => {
  if (searchVisible.value) dispatchSearchQuery();
});

onBeforeUnmount(() => {
  if (searchUpdateTimer) {
    clearTimeout(searchUpdateTimer);
    searchUpdateTimer = null;
  }
});

defineExpose({ openSearch, openReplace, closeSearch });
</script>

<template>
  <Transition enter-active-class="transition-[transform,opacity] duration-150" leave-active-class="transition-[transform,opacity] duration-100" enter-from-class="opacity-0 -translate-y-1" leave-to-class="opacity-0 -translate-y-1">
    <div v-if="searchVisible" class="editor-search-panel absolute right-4 top-3 z-[9999] isolate flex flex-col gap-1 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl ring-1 ring-border/60">
      <div class="flex items-center gap-1">
        <button class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" :title="showReplace ? t('editor.search.collapseReplace') : t('editor.search.expandReplace')" @click="showReplace = !showReplace">
          <ChevronRight class="h-4 w-4 transition-transform" :class="showReplace && 'rotate-90'" />
        </button>
        <div class="flex h-8 w-64 items-center rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          <input
            ref="searchInputRef"
            v-model="searchText"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            class="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            :placeholder="t('editor.search.find')"
            @keydown="onSearchKeydown"
          />
          <button
            class="flex h-6 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-foreground"
            :class="caseSensitive ? 'bg-accent text-foreground' : 'text-muted-foreground'"
            :title="t('editor.search.caseSensitive')"
            @click="caseSensitive = !caseSensitive"
          >
            Aa
          </button>
          <button
            class="mr-1 flex h-6 min-w-7 items-center justify-center rounded px-1.5 font-mono text-xs transition-colors hover:bg-accent hover:text-foreground"
            :class="useRegex ? 'bg-accent text-foreground' : 'text-muted-foreground'"
            :title="t('editor.search.regex')"
            @click="useRegex = !useRegex"
          >
            .*
          </button>
        </div>
        <span class="min-w-[3.4rem] shrink-0 text-center text-xs" :class="searchText && matchCount === 0 ? 'text-destructive' : 'text-muted-foreground'">
          {{ searchText && matchCount > 0 ? `${currentMatchIndex}/${matchCount}${matchCountLimited ? "+" : ""}` : t("editor.search.noResults") }}
        </span>
        <button class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" :title="t('editor.search.prevMatch')" @click="prevMatch">
          <ChevronUp class="h-4 w-4" />
        </button>
        <button class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" :title="t('editor.search.nextMatch')" @click="nextMatch">
          <ChevronDown class="h-4 w-4" />
        </button>
        <button class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" :title="t('editor.search.close')" @click="closeSearch">
          <X class="h-4 w-4" />
        </button>
      </div>
      <div v-if="showReplace" class="flex items-center gap-1">
        <div class="h-7 w-7 shrink-0" />
        <div class="flex h-8 w-64 items-center rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          <input
            ref="replaceInputRef"
            v-model="replaceText"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            class="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            :placeholder="t('editor.search.replace')"
            @keydown.enter.prevent="doReplace"
            @keydown.escape.prevent="closeSearch"
          />
        </div>
        <button class="flex h-7 items-center justify-center rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" :title="t('editor.search.replace')" @click="doReplace">
          {{ t("editor.search.replace") }}
        </button>
        <button class="flex h-7 items-center justify-center rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" :title="t('editor.search.replaceAll')" @click="doReplaceAll">
          {{ t("editor.search.replaceAll") }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.editor-search-panel {
  max-width: min(calc(100vw - 2rem), 620px);
}

@media (max-width: 720px) {
  .editor-search-panel {
    left: 0.75rem;
    right: 0.75rem;
  }
}
</style>
