// A deliberately small markdown -> Tiptap JSON converter. It doesn't need
// to round-trip everything a real editor could produce — it only needs to
// turn the vault's plain-prose resume/notes files into a valid, editable
// Tiptap document on import. Headings, bullet lists, and paragraphs cover
// everything the source files actually use.
type TiptapNode = { type: string; attrs?: Record<string, unknown>; content?: TiptapNode[]; text?: string };

function textNode(text: string): TiptapNode[] {
  return text ? [{ type: "text", text }] : [];
}

export function markdownToTiptapDoc(markdown: string): { type: "doc"; content: TiptapNode[] } {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: TiptapNode[] = [];
  let listItems: TiptapNode[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(" ").trim();
    if (text) content.push({ type: "paragraph", content: textNode(text) });
    paragraphBuffer = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    content.push({ type: "bulletList", content: listItems });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1]!.length, 6);
      content.push({ type: "heading", attrs: { level }, content: textNode(heading[2]!.trim()) });
      continue;
    }
    if (bullet) {
      flushParagraph();
      listItems.push({ type: "listItem", content: [{ type: "paragraph", content: textNode(bullet[1]!.trim()) }] });
      continue;
    }
    flushList();
    paragraphBuffer.push(line.trim());
  }
  flushParagraph();
  flushList();

  if (content.length === 0) content.push({ type: "paragraph", content: [] });
  return { type: "doc", content };
}

/** Flattens a Tiptap doc back to plain text — used as the cached LLM prompt prefix and for search. */
export function tiptapDocToText(doc: { type: "doc"; content: TiptapNode[] }): string {
  const parts: string[] = [];
  const walk = (node: TiptapNode) => {
    if (node.type === "text" && node.text) parts.push(node.text);
    if (node.content) {
      for (const child of node.content) walk(child);
      if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") parts.push("\n");
    }
  };
  for (const node of doc.content) walk(node);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}
