export type Kind = "http-5xx" | "prisma-error" | "exception" | "migration" | "oom" | "restart";

const HTTP_5XX =
  /(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+\s+5\d\d\b|\bstatus(?:Code)?[=: ]+5\d\d\b/;

const STACK = /(?:^|\n)\s*at \S+/;

export function detectKinds(text: string): Kind[] {
  const kinds: Kind[] = [];
  if (HTTP_5XX.test(text)) kinds.push("http-5xx");
  if (/prisma:error/.test(text)) kinds.push("prisma-error");
  if (
    /unhandledRejection|uncaughtException/.test(text) ||
    (/Error:/.test(text) && STACK.test(text))
  ) {
    kinds.push("exception");
  }
  if (/P3009|P3018|P1001/.test(text) || /Migration\b[\s\S]{0,80}\bfailed/i.test(text)) {
    kinds.push("migration");
  }
  if (/heap out of memory|ENOMEM|OOMKilled/i.test(text)) kinds.push("oom");
  return kinds;
}
