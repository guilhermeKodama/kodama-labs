/** The fields of a DOM element isEditableTarget reads (tests pass plain objects). */
export interface ElementLike {
  tagName?: string;
  type?: string;
  readOnly?: boolean;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

// Inputs that are buttons in disguise: typing a letter there edits nothing.
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
// Roles that take typed characters: a contenteditable textbox, or a select-like
// trigger with typeahead (Radix Select renders a button with role="combobox").
const TYPING_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/**
 * Whether keys pressed with focus on `target` belong to it (typing, caret
 * moves, native undo), so single-key and app shortcuts must not fire.
 */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as ElementLike;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  if (tag === "INPUT") return !element.readOnly && !NON_TEXT_INPUTS.has((element.type || "text").toLowerCase());
  if (tag === "TEXTAREA") return !element.readOnly;
  if (tag === "SELECT") return true;
  const role = element.getAttribute?.("role");
  return role ? TYPING_ROLES.has(role) : false;
}
