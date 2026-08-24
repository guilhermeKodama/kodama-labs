"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export async function createNote(params: { jobId?: string; companyId?: string; path: string }): Promise<{ id: string }> {
  const note = await prisma.note.create({
    data: {
      jobId: params.jobId ?? null,
      companyId: params.companyId ?? null,
      contentJson: EMPTY_DOC,
      contentText: "",
    },
  });
  revalidatePath(params.path);
  return { id: note.id };
}

export async function updateNoteTitle(noteId: string, title: string, path: string): Promise<void> {
  await prisma.note.update({ where: { id: noteId }, data: { title: title.trim() || null } });
  revalidatePath(path);
}

export async function updateNoteContent(noteId: string, json: object, text: string): Promise<void> {
  await prisma.note.update({ where: { id: noteId }, data: { contentJson: json as unknown as object, contentText: text } });
}

export async function togglePinNote(noteId: string, pinned: boolean, path: string): Promise<void> {
  await prisma.note.update({ where: { id: noteId }, data: { pinned } });
  revalidatePath(path);
}

export async function deleteNote(noteId: string, path: string): Promise<void> {
  await prisma.note.delete({ where: { id: noteId } });
  revalidatePath(path);
}
