// @vitest-environment happy-dom

import { acceptCompletion, autocompletion, closeCompletion, currentCompletions, moveCompletionSelection, selectedCompletionIndex, startCompletion } from "@codemirror/autocomplete";
import { EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryEditorCompletionHighlight } from "@/lib/editor/queryEditorCompletionHighlight";

let view: EditorView | undefined;

async function openCompletion(selectOnOpen = false) {
  vi.useFakeTimers();
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      extensions: [
        autocompletion({
          selectOnOpen,
          interactionDelay: 0,
          activateOnTypingDelay: 0,
          override: [() => ({ from: 0, options: [{ label: "select" }, { label: "set" }], validFor: /^\w*$/ })],
        }),
        createQueryEditorCompletionHighlight({ StateEffect, StateField, ViewPlugin, autocompletion, currentCompletions, selectedCompletionIndex }),
      ],
    }),
  });
  startCompletion(view);
  await vi.advanceTimersByTimeAsync(60);
  expect(currentCompletions(view.state)).toHaveLength(2);
  return view;
}

function pending() {
  return !!document.querySelector(".cm-tooltip-autocomplete.cm-completion-highlight-pending");
}

afterEach(() => {
  view?.destroy();
  view = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("completion highlight debounce", () => {
  it("waits for typing to settle without selecting the first candidate", async () => {
    const editor = await openCompletion();
    expect(pending()).toBe(true);
    for (const text of ["s", "e", "l"]) {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: text }, selection: { anchor: editor.state.doc.length + 1 }, annotations: Transaction.userEvent.of("input.type") });
      await vi.advanceTimersByTimeAsync(75);
      expect(pending()).toBe(true);
    }
    await vi.advanceTimersByTimeAsync(25);
    expect(pending()).toBe(false);
    expect(selectedCompletionIndex(editor.state)).toBeNull();
    expect(acceptCompletion(editor)).toBe(false);
  });

  it("shows explicit keyboard selection immediately", async () => {
    const editor = await openCompletion();
    expect(pending()).toBe(true);
    expect(moveCompletionSelection(true)(editor)).toBe(true);
    expect(pending()).toBe(false);
    expect(selectedCompletionIndex(editor.state)).toBe(0);
    expect(acceptCompletion(editor)).toBe(true);
  });

  it("does not delay acceptance when automatic selection is enabled", async () => {
    const editor = await openCompletion(true);
    expect(pending()).toBe(true);
    expect(selectedCompletionIndex(editor.state)).toBe(0);
    expect(acceptCompletion(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("select");
  });

  it("cancels pending coloring when closed or destroyed", async () => {
    const editor = await openCompletion();
    closeCompletion(editor);
    const dispatch = vi.spyOn(editor, "dispatch");
    await vi.advanceTimersByTimeAsync(300);
    expect(dispatch).not.toHaveBeenCalled();
    expect(document.querySelector(".cm-tooltip-autocomplete")).toBeNull();
    startCompletion(editor);
    await vi.advanceTimersByTimeAsync(60);
    editor.destroy();
    view = undefined;
    dispatch.mockClear();
    await vi.advanceTimersByTimeAsync(300);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
