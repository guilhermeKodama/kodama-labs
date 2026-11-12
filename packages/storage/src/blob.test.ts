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

  it("does not fetch a url that is not a local blob", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://files.example/capital/user/file.pdf";

    await expect(headObject(url)).resolves.toBeNull();
    await expect(getObjectBuffer(url)).resolves.toBeNull();
    await deleteObject(url);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
