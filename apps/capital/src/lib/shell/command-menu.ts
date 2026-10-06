/**
 * Opens the ⌘K palette from a control (the sidebar's "Buscar ou executar…").
 * The palette (components/shell/command.tsx) listens for this window event,
 * so callers need no context.
 */
export const COMMAND_MENU_EVENT = "capital:command";

export function openCommandMenu(): void {
  window.dispatchEvent(new CustomEvent(COMMAND_MENU_EVENT));
}
