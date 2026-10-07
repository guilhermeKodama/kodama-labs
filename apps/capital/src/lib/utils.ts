import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { TEXT_ROLES } from "@/lib/theme/type-scale"

/**
 * The type roles of src/app/theme.css (text-caption, text-body, …).
 * tailwind-merge does not know them and would take text-caption for a text
 * color, dropping it next to text-fg-3.
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: [...TEXT_ROLES] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
