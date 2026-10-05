/**
 * The argument names of an ICU message ("{count, plural, one {# item} other
 * {# items}} in {name}" → ["count", "name"]), including those inside
 * plural and select branches. Follows ICU quoting: '' is an apostrophe,
 * and an apostrophe right before {, }, | (or # inside a plural) starts a
 * quoted literal up to the next lone apostrophe.
 *
 * Throws on a message next-intl could not parse (unbalanced braces, a
 * plural without branches), so the parity test also catches broken text.
 */
export function icuArguments(message: string): string[] {
  const names = new Set<string>();
  let pos = 0;

  const fail = (reason: string): never => {
    throw new Error(`${reason} at ${pos} in ${JSON.stringify(message)}`);
  };
  const skipSpace = () => {
    while (pos < message.length && /\s/.test(message[pos])) pos++;
  };
  const readWord = () => {
    const start = pos;
    while (pos < message.length && !/[\s,{}]/.test(message[pos])) pos++;
    return message.slice(start, pos);
  };

  /** Text up to the "}" that closes the current branch (depth > 0) or to the end. */
  function text(depth: number, inPlural: boolean): void {
    while (pos < message.length) {
      const char = message[pos];
      if (char === "'") {
        const next = message[pos + 1];
        if (next === "'") {
          pos += 2;
        } else if (next === "{" || next === "}" || next === "|" || (inPlural && next === "#")) {
          pos += 1;
          while (pos < message.length) {
            if (message[pos] === "'" && message[pos + 1] === "'") pos += 2;
            else if (message[pos] === "'") break;
            else pos++;
          }
          if (pos >= message.length) fail("unterminated quote");
          pos++;
        } else {
          pos++;
        }
      } else if (char === "{") {
        argument();
      } else if (char === "}") {
        if (depth === 0) fail("unexpected }");
        return;
      } else {
        pos++;
      }
    }
    if (depth > 0) fail("missing }");
  }

  function argument(): void {
    pos++; // {
    skipSpace();
    const name = readWord();
    if (!name) fail("empty argument");
    names.add(name);
    skipSpace();
    if (message[pos] === "}") {
      pos++;
      return;
    }
    if (message[pos] !== ",") fail("expected , or }");
    pos++;
    skipSpace();
    const type = readWord();
    skipSpace();
    if (message[pos] === "}") {
      pos++;
      return;
    }
    if (message[pos] !== ",") fail("expected , or }");
    pos++;
    if (type === "plural" || type === "selectordinal" || type === "select") {
      let branches = 0;
      for (;;) {
        skipSpace();
        if (message[pos] === "}") break;
        const selector = readWord();
        if (!selector) fail("expected a branch");
        skipSpace();
        if (selector.startsWith("offset:")) continue;
        if (message[pos] !== "{") fail("expected {");
        pos++;
        text(1, type !== "select");
        pos++; // }
        branches++;
      }
      if (!branches || pos >= message.length) fail(`${type} without branches`);
      pos++;
      return;
    }
    // number, date or time with a style ("::currency/BRL", "percent").
    let depth = 1;
    while (pos < message.length && depth > 0) {
      if (message[pos] === "{") depth++;
      else if (message[pos] === "}") depth--;
      pos++;
    }
    if (depth > 0) fail("missing }");
  }

  text(0, false);
  return [...names].sort();
}
