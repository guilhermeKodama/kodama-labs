/** Where a label may break, best first. A separator is dropped at the break; punctuation stays. */
const BREAKS: ReadonlyArray<{ after: RegExp; drop: number }> = [
  { after: / · /g, drop: 3 },
  { after: /[,:;] /g, drop: 1 },
  { after: / /g, drop: 1 },
];

/**
 * Breaks a label into lines of at most `max` characters. SVG text does not
 * wrap, and a narrow figure has no room for the long lines of a wide one.
 *
 * It prefers to break where the sentence does: at a separator dot, then after
 * punctuation, then at any space, as long as the line it leaves is not a stub.
 * A word longer than a line is left whole.
 */
export function wrapLabel(text: string, max: number): string[] {
  if (text.length <= max) return [text];

  for (const { after, drop } of BREAKS) {
    const ends = [...text.matchAll(after)]
      // Where the first line would end, and where the next would start.
      .map((match) => ({ end: match.index + match[0].length - drop, next: match.index + match[0].length }))
      .filter(({ end }) => end <= max && end >= max * 0.4);
    const last = ends.at(-1);
    if (last) return [text.slice(0, last.end), ...wrapLabel(text.slice(last.next), max)];
  }

  const space = text.lastIndexOf(' ', max);
  if (space <= 0) return [text];
  return [text.slice(0, space), ...wrapLabel(text.slice(space + 1), max)];
}
