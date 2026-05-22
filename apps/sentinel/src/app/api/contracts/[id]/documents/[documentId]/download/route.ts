import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sentinel/server/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id, documentId } = await params;

  const document = await prisma.contractDocument.findFirst({
    where: { id: documentId, contractId: id },
    select: { storageKey: true, sourceUrl: true },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (document.storageKey) {
    return NextResponse.redirect(document.storageKey, {
      status: 302,
      headers: { "Cache-Control": "private, max-age=240" },
    });
  }

  if (document.sourceUrl) {
    return NextResponse.redirect(document.sourceUrl, 302);
  }

  return NextResponse.json(
    { error: "Document not available in storage" },
    { status: 404 },
  );
}
