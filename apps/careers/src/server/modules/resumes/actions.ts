"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { uploadResumeFile } from "../../lib/storage";
import { extractTextFromFile } from "../../lib/extract-text";
import { markdownToTiptapDoc, tiptapDocToText } from "../../../scripts/markdown-to-tiptap";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);

export async function uploadResume(formData: FormData): Promise<{ error?: string }> {
  const file = formData.get("file");
  const label = String(formData.get("label") ?? "").trim();
  if (!(file instanceof File)) return { error: "Nenhum arquivo enviado." };
  if (!label) return { error: "Escolha uma trilha (ex: Product, Systems)." };
  if (file.size > MAX_FILE_SIZE_BYTES) return { error: "Arquivo maior que 10MB." };
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type) && !/\.(pdf|docx|md|txt)$/i.test(file.name)) {
    return { error: "Formato não suportado — use PDF, DOCX, Markdown ou texto." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const text = await extractTextFromFile(buffer, file.type, file.name);
  const doc = markdownToTiptapDoc(text);
  const flatText = tiptapDocToText(doc);

  const lastVersion = await prisma.resumeVersion.findFirst({
    where: { label },
    orderBy: { version: "desc" },
  });
  const version = (lastVersion?.version ?? 0) + 1;

  const { url, pathname } = await uploadResumeFile({
    label,
    version,
    originalName: file.name,
    body: buffer,
    contentType: file.type || "application/octet-stream",
  });

  const hasDefault = await prisma.resumeVersion.findFirst({ where: { isDefault: true } });

  await prisma.resumeVersion.create({
    data: {
      label,
      version,
      originalName: file.name,
      blobUrl: url,
      pathname,
      mimeType: file.type || null,
      sizeBytes: file.size,
      contentJson: doc as unknown as object,
      contentText: flatText,
      isDefault: !hasDefault,
      notes: `Enviado em ${new Date().toLocaleDateString("pt-BR")}`,
    },
  });

  revalidatePath("/curriculo");
  return {};
}

export async function setDefaultResume(resumeId: string): Promise<void> {
  await prisma.resumeVersion.updateMany({ data: { isDefault: false } });
  await prisma.resumeVersion.update({ where: { id: resumeId }, data: { isDefault: true } });
  revalidatePath("/curriculo");
}

export async function saveResumeContent(resumeId: string, json: object, text: string): Promise<void> {
  await prisma.resumeVersion.update({
    where: { id: resumeId },
    data: { contentJson: json as unknown as object, contentText: text },
  });
}
