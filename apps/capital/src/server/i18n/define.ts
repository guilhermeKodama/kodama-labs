/** A dictionary tree: nested objects whose leaves are message strings. */
export type MessageTree = { readonly [key: string]: string | MessageTree };

/** The same shape as `T` with every leaf a string: what each other locale must provide. */
export type Translation<T> = { readonly [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };

/** Dotted paths to the leaves of a tree, e.g. "direction.reimbursement". */
export type LeafPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : LeafPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/**
 * One domain's server-side strings. pt-BR is the source of the keys; en must
 * have exactly the same ones (a missing or extra key is a type error).
 */
export function defineDictionary<T extends MessageTree>(ptBR: T, en: Translation<T>) {
  return { "pt-BR": ptBR, en };
}
