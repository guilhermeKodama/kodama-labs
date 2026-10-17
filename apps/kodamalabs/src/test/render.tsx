import fs from 'node:fs';
import path from 'node:path';

import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Locale } from '@/i18n/locales';
import { NAMESPACES } from '@/i18n/messages';

const MESSAGES_DIR = path.resolve(__dirname, '../messages');

export type MessageTree = { [key: string]: string | MessageTree };

/** The messages of a locale, read from disk the way the app merges them. */
export function messagesFor(locale: Locale): MessageTree {
  const messages: MessageTree = {};
  for (const namespace of NAMESPACES) {
    const file = path.join(MESSAGES_DIR, locale, `${namespace}.json`);
    messages[namespace] = JSON.parse(fs.readFileSync(file, 'utf8')) as MessageTree;
  }
  return messages;
}

/** Every message string of a tree, flattened. */
export function messageValues(tree: MessageTree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : messageValues(value),
  );
}

/**
 * Renders server components to HTML in Node. Pages and figures are pure and
 * synchronous, so this is the same markup Next produces.
 */
export function renderWithMessages(
  node: ReactNode,
  locale: Locale = 'en',
  messages: MessageTree = messagesFor(locale),
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}

/** Text of a piece of markup with the tags removed, one node per line. */
export function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, '\n');
}

/** Attributes of every element with the given tag name, in document order. */
export function elements(html: string, tag: string): Array<Record<string, string>> {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((match) =>
    Object.fromEntries(
      [...match[1]!.matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)].map((attr) => [attr[1]!, attr[2]!]),
    ),
  );
}

/** A figure of the motion layer: an element with `data-fig`. */
export interface FigureMarkup {
  id: string;
  state: string | undefined;
  /** `data-k` of every part inside it, in document order. */
  keys: string[];
  /** Attributes of each part, by key. */
  parts: Record<string, Record<string, string>>;
  /** True when it sits inside another figure, which the motion layer forbids. */
  nested: boolean;
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function attributes(raw: string): Record<string, string> {
  return Object.fromEntries(
    [...raw.matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)].map((attr) => [attr[1]!, attr[2]!]),
  );
}

/** Every figure of a piece of markup, with the parts each one contains. */
export function figuresOf(html: string): FigureMarkup[] {
  const open: Array<FigureMarkup | null> = [];
  const figures: FigureMarkup[] = [];

  for (const match of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/g)) {
    const [, closing, tag, raw, selfClosing] = match;
    if (closing) {
      open.pop();
      continue;
    }

    const attrs = attributes(raw!);
    const parent = open.findLast((entry) => entry !== null) ?? null;
    let figure: FigureMarkup | null = null;

    if (attrs['data-k'] && parent) {
      parent.keys.push(attrs['data-k']);
      parent.parts[attrs['data-k']] = attrs;
    }
    if (attrs['data-fig'] && attrs['data-from']) {
      // A later act of the same drawing: its parts belong to the figure it continues.
      figure = figures.findLast((earlier) => earlier.id === attrs['data-fig']) ?? null;
      if (figure && attrs['data-state'] !== figure.state) figure.state = undefined;
      if (figure && parent !== null) figure.nested = true;
    } else if (attrs['data-fig']) {
      figure = {
        id: attrs['data-fig'],
        state: attrs['data-state'],
        keys: [],
        parts: {},
        nested: parent !== null,
      };
      figures.push(figure);
    }
    if (!selfClosing && !VOID_ELEMENTS.has(tag!)) open.push(figure);
  }

  return figures;
}
