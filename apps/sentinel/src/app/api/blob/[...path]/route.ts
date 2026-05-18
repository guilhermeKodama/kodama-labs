import { NextRequest, NextResponse } from "next/server";
import { isLocalBlobMode, readLocalBlob } from "@/lib/storage/blob";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!isLocalBlobMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { path: segments } = await params;
  const pathname = segments.map(decodeURIComponent).join("/");

  const blob = await readLocalBlob(pathname);
  if (!blob) {
    return NextResponse.json({ error: "Blob not found" }, { status: 404 });
  }

  return new NextResponse(blob.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": blob.contentType,
      "Content-Length": blob.buffer.length.toString(),
      "Cache-Control": "private, max-age=240",
    },
  });
}
