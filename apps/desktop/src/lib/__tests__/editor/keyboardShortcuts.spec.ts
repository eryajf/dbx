import { describe, expect, it } from "vitest";
import { eventToModifierOnlyShortcut, eventToShortcut, isExecuteSqlInNewResultTabShortcut, matchesModifierOnlyShortcut, matchesShortcut } from "@/lib/editor/keyboardShortcuts";
import { formatShortcutDisplay } from "@/lib/editor/shortcutDisplay";

describe("keyboard shortcut matching", () => {
  it("records modifier-only mouse shortcut settings", () => {
    expect(eventToModifierOnlyShortcut({ key: "Alt", altKey: true })).toBe("Alt");
    expect(eventToModifierOnlyShortcut({ key: "Shift", shiftKey: true })).toBe("Shift");
    expect(eventToModifierOnlyShortcut({ key: "Control", ctrlKey: true }, "Win32")).toBe("Mod");
    expect(eventToModifierOnlyShortcut({ key: "Meta", metaKey: true }, "Win32")).toBe("Meta");
    expect(eventToModifierOnlyShortcut({ key: "Meta", metaKey: true }, "MacIntel")).toBe("Mod");
    expect(eventToModifierOnlyShortcut({ key: "Control", ctrlKey: true }, "MacIntel")).toBe("Ctrl");
    expect(eventToModifierOnlyShortcut({ key: "A", altKey: true })).toBeNull();
  });

  it("matches a configured mouse modifier exactly", () => {
    expect(matchesModifierOnlyShortcut({ altKey: true }, "Alt")).toBe(true);
    expect(matchesModifierOnlyShortcut({ ctrlKey: true }, "Mod")).toBe(true);
    expect(matchesModifierOnlyShortcut({ metaKey: true }, "Mod")).toBe(true);
    expect(matchesModifierOnlyShortcut({ ctrlKey: true }, "Ctrl")).toBe(true);
    expect(matchesModifierOnlyShortcut({ metaKey: true }, "Meta")).toBe(true);
    expect(matchesModifierOnlyShortcut({ altKey: true, shiftKey: true }, "Alt")).toBe(false);
    expect(matchesModifierOnlyShortcut({ shiftKey: true }, "")).toBe(false);
  });

  it("records the plus key without losing it to the separator", () => {
    expect(eventToShortcut({ key: "+", ctrlKey: true }, "Win32")).toBe("Mod+Plus");
    expect(eventToShortcut({ key: "+", ctrlKey: true, shiftKey: true }, "Win32")).toBe("Shift+Mod+Plus");
  });

  it("keeps Control distinct from Command when recording macOS shortcuts", () => {
    const controlShortcut = eventToShortcut({ key: "b", ctrlKey: true }, "MacIntel");

    expect(controlShortcut).toBe("Ctrl+B");
    expect(formatShortcutDisplay(controlShortcut!, "MacIntel")).toBe("⌃ B");
    expect(matchesShortcut({ key: "b", ctrlKey: true }, controlShortcut!, "MacIntel")).toBe(true);
    expect(matchesShortcut({ key: "b", metaKey: true }, controlShortcut!, "MacIntel")).toBe(false);
    expect(eventToShortcut({ key: "b", metaKey: true }, "MacIntel")).toBe("Mod+B");
  });

  it("keeps Ctrl as the platform modifier outside macOS and preserves combined modifiers", () => {
    expect(eventToShortcut({ key: "b", ctrlKey: true }, "Win32")).toBe("Mod+B");
    const combinedShortcut = eventToShortcut({ key: "b", ctrlKey: true, metaKey: true, shiftKey: true, altKey: true }, "MacIntel");

    expect(combinedShortcut).toBe("Shift+Ctrl+Mod+Alt+B");
    expect(matchesShortcut({ key: "b", ctrlKey: true, metaKey: true, shiftKey: true, altKey: true }, combinedShortcut!, "MacIntel")).toBe(true);
    expect(matchesShortcut({ key: "b", ctrlKey: true, shiftKey: true, altKey: true }, combinedShortcut!, "MacIntel")).toBe(false);
    expect(matchesShortcut({ key: "b", metaKey: true, shiftKey: true, altKey: true }, combinedShortcut!, "MacIntel")).toBe(false);
  });

  it("matches canonical plus-key shortcuts", () => {
    expect(matchesShortcut({ key: "+", ctrlKey: true }, "Mod+Plus")).toBe(true);
    expect(matchesShortcut({ key: "+", ctrlKey: true, shiftKey: true }, "Shift+Mod+Plus")).toBe(true);
  });

  it("matches the configurable execute-in-new-result-tab shortcut", () => {
    expect(isExecuteSqlInNewResultTabShortcut({ key: "\\", ctrlKey: true }, { executeSqlInNewResultTab: "Mod+\\" })).toBe(true);
    expect(isExecuteSqlInNewResultTabShortcut({ key: "\\", metaKey: true }, { executeSqlInNewResultTab: "Mod+\\" })).toBe(true);
    expect(isExecuteSqlInNewResultTabShortcut({ key: "\\", ctrlKey: true, shiftKey: true }, { executeSqlInNewResultTab: "Mod+\\" })).toBe(false);
  });

  it("matches legacy plus-key shortcuts saved with plus as a separator", () => {
    expect(matchesShortcut({ key: "+", ctrlKey: true }, "Mod++")).toBe(true);
    expect(matchesShortcut({ key: "+", ctrlKey: true, shiftKey: true }, "Shift+Mod++")).toBe(true);
  });
});
