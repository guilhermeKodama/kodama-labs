/**
 * How the sidebar footer shows the signed-in user: the avatar's initials
 * ("GK") and the first name ("Guilherme"). Without a name (an account
 * created elsewhere), the e-mail's local part stands in for it.
 */

const STARTS_WITH_LETTER_OR_DIGIT = /^[\p{L}\p{N}]/u;

/** Words that can carry an initial, punctuation trimmed: "Ana (PJ) da Silva" → ["Ana", "PJ", "da", "Silva"]. */
function words(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => STARTS_WITH_LETTER_OR_DIGIT.test(word));
}

/** "guilherme.kodama@x.com" → ["guilherme", "kodama"]. */
function emailWords(email: string | null | undefined): string[] {
  const local = (email ?? "").split("@")[0] ?? "";
  return local.split(/[._+\-\s]+/).filter((word) => STARTS_WITH_LETTER_OR_DIGIT.test(word));
}

/** First code point, upper-cased (keeps accents and emoji whole). */
function firstLetter(word: string): string {
  return (Array.from(word)[0] ?? "").toLocaleUpperCase();
}

function capitalize(word: string): string {
  const [head = "", ...rest] = Array.from(word);
  return head.toLocaleUpperCase() + rest.join("");
}

/** "Guilherme Kodama" → "Guilherme"; no name → "Guilherme" from guilherme.kodama@…; nothing → "". */
export function firstName(name: string | null | undefined, email?: string | null): string {
  const [first] = words(name ?? "");
  if (first) return first;
  const [fromEmail] = emailWords(email);
  return fromEmail ? capitalize(fromEmail) : "";
}

/**
 * Avatar initials: the first letters of the first and last words
 * ("Guilherme Kodama" → "GK", "Ana Maria da Silva" → "AS", "Guilherme"
 * → "G"), else from the e-mail, else "?".
 */
export function initials(name: string | null | undefined, email?: string | null): string {
  const parts = words(name ?? "");
  const source = parts.length ? parts : emailWords(email);
  if (!source.length) return "?";
  const first = firstLetter(source[0]);
  return source.length > 1 ? first + firstLetter(source[source.length - 1]) : first;
}
