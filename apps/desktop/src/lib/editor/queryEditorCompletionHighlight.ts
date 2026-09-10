import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

interface CompletionHighlightDeps {
  StateEffect: typeof import("@codemirror/state").StateEffect;
  StateField: typeof import("@codemirror/state").StateField;
  ViewPlugin: typeof import("@codemirror/view").ViewPlugin;
  autocompletion: typeof import("@codemirror/autocomplete").autocompletion;
  currentCompletions: typeof import("@codemirror/autocomplete").currentCompletions;
  selectedCompletionIndex: typeof import("@codemirror/autocomplete").selectedCompletionIndex;
}

// Candidate lists are rebuilt while typing. Debounce their automatic highlight
// independently of completion selection, acceptance, and result delivery.
export function createQueryEditorCompletionHighlight({ StateEffect, StateField, ViewPlugin, autocompletion, currentCompletions, selectedCompletionIndex }: CompletionHighlightDeps): Extension {
  const showHighlight = StateEffect.define<void>();
  const candidatesChanged = (before: EditorState, after: EditorState) => currentCompletions(before) !== currentCompletions(after);
  const highlightReady = StateField.define<boolean>({
    create: () => false,
    update(ready, tr) {
      if (tr.docChanged || candidatesChanged(tr.startState, tr.state) || currentCompletions(tr.state).length === 0) return false;
      // Explicit navigation should respond immediately, even during the delay.
      if (selectedCompletionIndex(tr.state) !== selectedCompletionIndex(tr.startState)) return selectedCompletionIndex(tr.state) !== null;
      if (tr.effects.some((effect) => effect.is(showHighlight))) return true;
      return ready;
    },
  });

  return [
    highlightReady,
    autocompletion({ tooltipClass: (state) => (state.field(highlightReady) ? "" : "cm-completion-highlight-pending") }),
    ViewPlugin.fromClass(
      class {
        timer: ReturnType<typeof setTimeout> | null = null;

        constructor(view: EditorView) {
          this.schedule(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || candidatesChanged(update.startState, update.state) || update.state.field(highlightReady)) this.clearTimer();
          this.schedule(update.view);
        }

        schedule(view: EditorView) {
          if (this.timer !== null || view.state.field(highlightReady) || currentCompletions(view.state).length === 0) return;
          this.timer = setTimeout(() => {
            this.timer = null;
            view.dispatch({ effects: showHighlight.of() });
          }, 100);
        }

        clearTimer() {
          if (this.timer === null) return;
          clearTimeout(this.timer);
          this.timer = null;
        }

        destroy() {
          this.clearTimer();
        }
      },
    ),
  ];
}
