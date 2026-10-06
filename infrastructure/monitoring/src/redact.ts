const REPLACERS: Array<[RegExp, string]> = [
  [/postgres(?:ql)?:\/\/[^\s'")]+/gi, "postgresql://***"],
  [/\bBearer\s+\S+/gi, "Bearer ***"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt]"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [
    /((?:api[_-]?key|token|secret|password|DATABASE_URL|MCP_API_KEY)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    "$1***",
  ],
];

const EXCERPT_LIMIT = 500;

export function redact(text: string, limit = EXCERPT_LIMIT): string {
  let out = text;
  for (const [pattern, replacement] of REPLACERS) {
    out = out.replace(pattern, replacement);
  }
  if (out.length <= limit) return out;
  return `${out.slice(0, limit)}…`;
}
