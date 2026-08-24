"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { uploadContextDocFile } from "../../lib/storage";
import { extractTextFromFile } from "../../lib/extract-text";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export async function uploadContextDocument(formData: FormData): Promise<{ error?: string }> {
  const file = formData.get("file");
  const title = String(formData.get("title") ?? "").trim();
  if (!(file instanceof File)) return { error: "Nenhum arquivo enviado." };
  if (file.size > MAX_FILE_SIZE_BYTES) return { error: "Arquivo maior que 10MB." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const bodyText = await extractTextFromFile(buffer, file.type, file.name);

  const { url, pathname } = await uploadContextDocFile({
    originalName: file.name,
    body: buffer,
    contentType: file.type || "application/octet-stream",
  });

  const last = await prisma.contextDocument.findFirst({ orderBy: { sortOrder: "desc" } });

  await prisma.contextDocument.create({
    data: {
      kind: "upload",
      title: title || file.name,
      bodyText,
      blobUrl: url,
      pathname,
      mimeType: file.type || null,
      sizeBytes: file.size,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  revalidatePath("/curriculo");
  return {};
}

export async function toggleContextDocInPrompt(docId: string, includeInPrompt: boolean): Promise<void> {
  await prisma.contextDocument.update({ where: { id: docId }, data: { includeInPrompt } });
  revalidatePath("/curriculo");
}

export async function deleteContextDocument(docId: string): Promise<void> {
  await prisma.contextDocument.delete({ where: { id: docId } });
  revalidatePath("/curriculo");
}

export async function reorderContextDocuments(orderedIds: string[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.contextDocument.update({ where: { id }, data: { sortOrder: index } }))
  );
  revalidatePath("/curriculo");
}
