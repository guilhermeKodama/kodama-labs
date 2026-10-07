/** Class strings shared by the cap primitives (sizes from the mockup). */

/** Input box, --cap-control-h tall (26px at Médio): TextInput, Select and Combobox triggers. */
export const CONTROL =
  "h-(--cap-control-h) min-w-0 rounded-[6px] border border-stroke-1 bg-editor px-2 text-control outline-none placeholder:text-fg-3 focus:border-fg-muted disabled:cursor-not-allowed disabled:bg-fill-4 disabled:text-fg-muted aria-invalid:border-neg";

/**
 * Floating surface for menus, popovers and listboxes. It fades in but
 * closes at once: Radix keeps a closing layer mounted, still taking Esc as
 * the top layer, until its exit animation ends, so a second Esc during a
 * fade-out (meant for the dialog underneath) would be swallowed.
 */
export const FLOATING =
  "z-50 border border-stroke-1 bg-editor text-fg-1 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0";

/** Row inside menus and listboxes, --cap-menu-row-h tall (28px at Médio). */
export const MENU_ROW =
  "flex h-(--cap-menu-row-h) w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 text-left text-control outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-fill-3";

/** Dimmed page behind dialogs and sheets: the chrome color at 72%. */
export const BACKDROP =
  "fixed inset-0 z-50 bg-chrome/72 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
