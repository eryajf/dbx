<script setup lang="ts">
import { useI18n } from "vue-i18n";
import PasswordInput from "@/components/ui/PasswordInput.vue";

defineOptions({ inheritAttrs: false });

const password = defineModel<string>({ default: "" });
const remember = defineModel<boolean>("remember", { default: true });

defineProps<{
  placeholder?: string;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex items-center gap-3" v-bind="$attrs">
    <PasswordInput v-model="password" class="min-w-0 flex-1" :placeholder="placeholder" />
    <label class="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
      <input v-model="remember" type="checkbox" class="mr-0" />
      <span>{{ t("connection.rememberPassword") }}</span>
    </label>
  </div>
</template>
