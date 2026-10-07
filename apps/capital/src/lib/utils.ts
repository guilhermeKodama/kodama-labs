import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The text-size tokens of globals.css (text-cap-12, text-cap-10.5, …, scaled
 * by Ajustes › Tamanho da letra). tailwind-merge does not know them and would
 * take text-cap-12 for a text color, dropping it next to text-fg-3.
 */
export const TEXT_SIZE_TOKENS = ["10", "10.5", "11", "11.5", "12", "12.5", "13", "14", "15", "17", "22"] as const

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: TEXT_SIZE_TOKENS.map((size) => `cap-${size}`) }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
