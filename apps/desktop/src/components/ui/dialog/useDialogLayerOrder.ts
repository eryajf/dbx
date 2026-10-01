import { injectDialogRootContext } from "reka-ui";
import { computed, ref, watch } from "vue";

const BASE_DIALOG_Z_INDEX = 50;
let nextDialogZIndex = BASE_DIALOG_Z_INDEX;

/**
 * Keep the visual order of dialogs aligned with Reka UI's logical layer stack.
 *
 * Reparenting portal nodes changes only their DOM order. Reka UI keeps a
 * separate insertion ordered layer set for pointer-events and outside-click
 * handling, so reparenting can leave the visible top dialog unreachable. A
 * z-index gives each open dialog a new visual layer while its logical layer
 * remains where Reka UI registered it.
 */
export function useDialogLayerOrder() {
  const rootContext = injectDialogRootContext();
  const zIndex = ref(BASE_DIALOG_Z_INDEX);

  function raiseLayer() {
    zIndex.value = ++nextDialogZIndex;
  }

  watch(
    () => rootContext?.open.value ?? false,
    (isOpen) => {
      if (isOpen) {
        raiseLayer();
      }
    },
    { flush: "post", immediate: true },
  );

  return {
    layerStyle: computed(() => ({ zIndex: String(zIndex.value) })),
  };
}
