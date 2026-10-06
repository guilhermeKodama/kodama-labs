/**
 * Filtering and keyboard movement for the searchable Combobox
 * (src/components/cap/combobox.tsx). Pure so it can be tested and reused by
 * the domain pickers.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** Right-aligned secondary text (e.g. the entity of an account). Not searched. */
  hint?: string;
  /** Extra search terms that are not shown (e.g. a ticker's full name). */
  keywords?: string[];
  disabled?: boolean;
}

/** Lowercase, accents removed, whitespace collapsed: "Saúde  e Bem" → "saude e bem". */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Options matching every word of the query, best first: exact label, label
 * prefix, a word of the label starting with the query, then any substring
 * (keywords included). Ties keep the original order. An empty query returns
 * the options unchanged.
 */
export function filterOptions<T extends ComboboxOption>(options: readonly T[], query: string): T[] {
  const q = normalizeSearch(query);
  if (!q) return [...options];
  const words = q.split(" ");
  const ranked: { option: T; rank: number; index: number }[] = [];
  options.forEach((option, index) => {
    const label = normalizeSearch(option.label);
    const haystack = [label, ...(option.keywords ?? []).map(normalizeSearch)].join(" ");
    if (!words.every((word) => haystack.includes(word))) return;
    const rank = label === q ? 0 : label.startsWith(q) ? 1 : label.split(" ").some((part) => part.startsWith(words[0])) ? 2 : 3;
    ranked.push({ option, rank, index });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.option);
}

/** Whether "+ Criar “query”" makes sense: some text, and no option already has that name. */
export function canCreateOption(options: readonly ComboboxOption[], query: string): boolean {
  const q = normalizeSearch(query);
  return q.length > 0 && !options.some((option) => normalizeSearch(option.label) === q);
}

/**
 * Next active row when moving by `delta` (±1, or ±Infinity for Home/End),
 * skipping disabled rows and wrapping around. -1 when nothing is enabled.
 */
export function moveActive(items: readonly { disabled?: boolean }[], current: number, delta: number): number {
  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);
  if (!enabled.length) return -1;
  if (delta === Infinity) return enabled[enabled.length - 1];
  if (delta === -Infinity) return enabled[0];
  const position = enabled.indexOf(current);
  if (position < 0) return delta > 0 ? enabled[0] : enabled[enabled.length - 1];
  const next = (((position + delta) % enabled.length) + enabled.length) % enabled.length;
  return enabled[next];
}
