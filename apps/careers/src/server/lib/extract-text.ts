// Converts an uploaded resume file (PDF, DOCX, or plain markdown/text) to
// plain text, which markdownToTiptapDoc then turns into an editable
// document. Anything unrecognized falls back to a UTF-8 decode rather than
// throwing — a resume upload failing outright is worse than one that lands
// as one big paragraph the user can reformat by hand.
export async function extractTextFromFile(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const lower = filename.toLowerCase();

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  return buffer.toString("utf8");
}
