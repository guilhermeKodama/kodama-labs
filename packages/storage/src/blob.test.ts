import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteObject, getObjectBuffer, headObject, putObject } from "./blob";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "blob-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.APP_URL;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("local blob storage", () => {
  it("puts, heads, reads, and deletes under the local key", async () => {
    const localDir = await tempDir();
    const opts = { localDir, appUrl: "https://capital.example" };
    const body = Buffer.from("receipt");

    const stored = await putObject("capital/user/receipts/file.pdf", body, "application/pdf", opts);

    expect(stored).toMatchObject({
      url: "https://capital.example/api/blob/capital/user/receipts/file.pdf",
      downloadUrl: stored.url,
      pathname: "capital/user/receipts/file.pdf",
      contentType: "application/pdf",
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(localDir, "capital/user/receipts/file.pdf.meta.json"),
          "utf8",
        ),
      ),
    ).toEqual({ contentType: "application/pdf" });

    await expect(headObject(stored.url, opts)).resolves.toEqual({ size: body.length });
    await expect(getObjectBuffer(stored.url, opts)).resolves.toEqual(body);

    await deleteObject(stored.url, opts);
    await expect(getObjectBuffer(stored.url, opts)).resolves.toBeNull();
    await expect(headObject(stored.url, opts)).resolves.toBeNull();
  });

  it("prefers runtime APP_URL over the build-time appUrl", async () => {
    const localDir = await tempDir();
    process.env.APP_URL = "https://runtime.example";
    const stored = await putObject(
      "capital/user/file.pdf",
      Buffer.from("x"),
      "application/pdf",
      { localDir, appUrl: "https://build.example" },
    );
    expect(stored.url).toBe("https://runtime.example/api/blob/capital/user/file.pdf");

    delete process.env.APP_URL;
    const fallback = await putObject(
      "capital/user/other.pdf",
      Buffer.from("y"),
      "application/pdf",
      { localDir, appUrl: "https://build.example" },
    );
    expect(fallback.url).toBe("https://build.example/api/blob/capital/user/other.pdf");
  });

  it("fetches a legacy remote url without deleting it", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? "GET" });
        if ((init?.method ?? "GET") === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "content-length": "4" },
          });
        }
        return new Response(Buffer.from("remote"));
      }),
    );

    const url = "https://abc.public.blob.vercel-storage.com/capital/user/file.pdf";
    await expect(headObject(url)).resolves.toEqual({ size: 4 });
    await expect(getObjectBuffer(url)).resolves.toEqual(Buffer.from("remote"));
    await deleteObject(url);

    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
    expect(calls.every((call) => call.url === url)).toBe(true);
  });

  it("returns null for a missing legacy object and throws on other HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    await expect(
      getObjectBuffer("https://abc.public.blob.vercel-storage.com/missing.pdf"),
    ).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(
      getObjectBuffer("https://abc.public.blob.vercel-storage.com/missing.pdf"),
    ).rejects.toThrow(/500/);
  });
});
