<script setup lang="ts">
import { computed, ref } from "vue";

type StepId = "capabilities" | "connections" | "databases" | "overrides";

const steps: Array<{ id: StepId; title: string; description: string }> = [
  { id: "connections", title: "连接范围", description: "决定哪些连接可被 MCP 看见" },
  { id: "databases", title: "数据库范围", description: "为每个连接限定可访问的库" },
  { id: "overrides", title: "连接例外", description: "按连接进一步收紧执行权限" },
  { id: "capabilities", title: "能力与执行", description: "选择 MCP 工具和全局操作级别" },
];

const currentStep = ref<StepId>("connections");
const currentIndex = computed(() => steps.findIndex((step) => step.id === currentStep.value));

function selectStep(step: StepId) {
  currentStep.value = step;
}

function previousStep() {
  const step = steps[currentIndex.value - 1];
  if (step) selectStep(step.id);
}

function nextStep() {
  const step = steps[currentIndex.value + 1];
  if (step) selectStep(step.id);
}
</script>

<template>
  <section class="space-y-4 rounded-md border bg-muted/10 p-3 sm:p-4">
    <header class="space-y-1">
      <p class="text-sm font-semibold">MCP 授权设置</p>
      <p class="text-xs text-muted-foreground">按顺序完成授权：先选择连接，再限定数据库和连接例外，最后确定可用工具与全局执行级别。</p>
    </header>

    <nav class="grid gap-2 sm:grid-cols-4" aria-label="MCP 授权步骤">
      <button
        v-for="(step, index) in steps"
        :key="step.id"
        type="button"
        class="group flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        :class="currentStep === step.id ? 'border-primary bg-primary/5' : 'bg-background hover:bg-muted/60'"
        :aria-current="currentStep === step.id ? 'step' : undefined"
        @click="selectStep(step.id)"
      >
        <span
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold"
          :class="currentStep === step.id ? 'border-primary bg-primary text-primary-foreground' : index < currentIndex ? 'border-primary/50 bg-primary/10 text-primary' : 'text-muted-foreground'"
          >{{ index + 1 }}</span
        >
        <span class="min-w-0">
          <span class="block truncate text-xs font-medium">{{ step.title }}</span>
          <span class="hidden truncate text-[10px] text-muted-foreground lg:block">{{ step.description }}</span>
        </span>
      </button>
    </nav>

    <div class="rounded-md border bg-background p-3 sm:p-4">
      <div v-show="currentStep === 'connections'" role="region" aria-label="第 1 步：连接范围"><slot name="connections" /></div>
      <div v-show="currentStep === 'databases'" role="region" aria-label="第 2 步：数据库范围"><slot name="databases" /></div>
      <div v-show="currentStep === 'overrides'" role="region" aria-label="第 3 步：连接例外"><slot name="overrides" /></div>
      <div v-show="currentStep === 'capabilities'" role="region" aria-label="第 4 步：能力与执行"><slot name="capabilities" /></div>
    </div>

    <footer class="flex items-center justify-between gap-3 border-t pt-3">
      <button type="button" class="rounded-md border bg-background px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50" :disabled="currentIndex === 0" @click="previousStep">上一步</button>
      <p class="text-center text-xs text-muted-foreground">第 {{ currentIndex + 1 }} 步，共 {{ steps.length }} 步</p>
      <button type="button" class="rounded-md border bg-background px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50" :disabled="currentIndex === steps.length - 1" @click="nextStep">下一步</button>
    </footer>
  </section>
</template>
