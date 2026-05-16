import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sentinel/server/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage/s3";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id, documentId } = await params;

  const document = await prisma.procurementDocument.findFirst({
    where: { id: documentId, procurementId: id },
    select: { storageKey: true, sourceUrl: true, title: true, mimeType: true },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!document.storageKey) {
    if (document.sourceUrl) {
      return NextResponse.redirect(document.sourceUrl, 302);
    }
    return NextResponse.json(
      { error: "Document not available in storage" },
      { status: 404 },
    );
  }

  const signedUrl = await getSignedDownloadUrl(document.storageKey, 300);
  if (!signedUrl) {
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 503 },
    );
  }

  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=240" },
  });
}
