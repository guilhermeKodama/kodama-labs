import { isLocalBlobMode, readLocalBlob, type StorageOptions } from "./blob";

type RouteContext = { params: Promise<{ path: string[] }> };

export function createLocalBlobHandler(opts?: StorageOptions) {
  return async function GET(
    _request: Request,
    { params }: RouteContext,
  ): Promise<Response> {
    if (!isLocalBlobMode(opts)) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { path: segments } = await params;
    const pathname = segments.map(decodeURIComponent).join("/");

    const blob = await readLocalBlob(pathname, opts);
    if (!blob) {
      return new Response(JSON.stringify({ error: "Blob not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(blob.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": blob.contentType,
        "Content-Length": blob.buffer.length.toString(),
        "Cache-Control": "private, max-age=240",
      },
    });
  };
}
