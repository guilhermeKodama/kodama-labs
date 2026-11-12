import type { Locale } from './locales';

/** One JSON file per namespace under src/messages/<locale>/. */
export const NAMESPACES = [
  'site',
  'hero',
  'work',
  'lab',
  'method',
  'about',
  'contact',
  'figures',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export type Messages = Record<Namespace, Record<string, unknown>>;

export async function loadMessages(locale: Locale): Promise<Messages> {
  const entries = await Promise.all(
    NAMESPACES.map(async (namespace) => {
      const file = await import(`../messages/${locale}/${namespace}.json`);
      return [namespace, file.default] as const;
    }),
  );
  return Object.fromEntries(entries) as Messages;
}
