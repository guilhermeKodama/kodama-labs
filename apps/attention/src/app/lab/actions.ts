"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/lib/prisma";
import { dispatchBeacon } from "@/server/lib/dispatch-beacon";

export async function triggerBeaconNow() {
  await dispatchBeacon();
  revalidatePath("/lab");
}

export async function startFocusWindow(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await prisma.focusWindow.create({ data: { label } });
  revalidatePath("/lab");
}

export async function endFocusWindow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.focusWindow.update({ where: { id }, data: { endsAt: new Date() } });
  revalidatePath("/lab");
}
