import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Prisma as CapitalPrisma } from "../apps/capital/src/generated/prisma/index.js";
import { Prisma as CareersPrisma } from "../apps/careers/src/generated/prisma/index.js";
import { Prisma as SentinelPrisma } from "../apps/sentinel/src/generated/prisma/index.js";
import {
  TABLES,
  batchWhere,
  prismaClientEntry,
  summarizeBatch,
  writeBlobFile,
  type AppName,
  type TableSpec,
} from "./migrate-vercel-blobs";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("prisma client path", () => {
  it("resolves each app from the script file, not the process cwd", () => {
    const script = "/repo/scripts/migrate-vercel-blobs.ts";
    for (const app of ["capital", "careers", "sentinel"] as const) {
      expect(prismaClientEntry(script, app)).toBe(
        `/repo/apps/${app}/src/generated/prisma/index.js`,
      );
    }
    expect(prismaClientEntry(script, "capital")).not.toContain("/apps/capital/apps/");
  });
});

type DmmfModel = { name: string; fields: Array<{ name: string }> };

function modelFor(models: DmmfModel[], spec: TableSpec): DmmfModel {
  const model = models.find(
    (candidate) =>
      candidate.name.charAt(0).toLowerCase() + candidate.name.slice(1) === spec.model,
  );
  if (!model) throw new Error(`missing model ${spec.model}`);
  return model;
}

function fieldNames(model: DmmfModel): Set<string> {
  return new Set(model.fields.map((field) => field.name));
}

describe("table columns exist on the Prisma DMMF", () => {
  const dmmfByApp: Record<AppName, DmmfModel[]> = {
    capital: CapitalPrisma.dmmf.datamodel.models as DmmfModel[],
    careers: CareersPrisma.dmmf.datamodel.models as DmmfModel[],
    sentinel: SentinelPrisma.dmmf.datamodel.models as DmmfModel[],
  };

  it("selects only columns the schema defines", () => {
    for (const app of Object.keys(TABLES) as AppName[]) {
      for (const spec of TABLES[app]) {
        const names = fieldNames(modelFor(dmmfByApp[app], spec));
        expect(names.has("id"), `${app}.${spec.model}.id`).toBe(true);
        expect(names.has(spec.urlField), `${app}.${spec.model}.${spec.urlField}`).toBe(true);
        if (spec.pathnameField) {
          expect(names.has(spec.pathnameField), `${app}.${spec.model}.${spec.pathnameField}`).toBe(
            true,
          );
        }
        if (spec.contentTypeField) {
          expect(
            names.has(spec.contentTypeField),
            `${app}.${spec.model}.${spec.contentTypeField}`,
          ).toBe(true);
        }
      }
    }
  });

  it("does not ask GeneratedDocument for mimeType", () => {
    const spec = TABLES.careers.find((table) => table.model === "generatedDocument");
    expect(spec?.contentTypeField).toBeNull();
    const names = fieldNames(modelFor(dmmfByApp.careers, spec!));
    expect(names.has("mimeType")).toBe(false);
    expect(names.has("blobUrl")).toBe(true);
    expect(names.has("pathname")).toBe(true);
  });
});

describe("cursor", () => {
  it("skips ids at or before --after and reports failed ids plus the resume id", () => {
    expect(batchWhere("blobUrl", "b")).toEqual({
      blobUrl: { contains: "blob.vercel-storage.com" },
      id: { gt: "b" },
    });
    const ids = ["a", "b", "c", "d"];
    const after = (batchWhere("blobUrl", "b").id as { gt: string }).gt;
    const page = ids.filter((id) => id > after).slice(0, 2);
    expect(page).toEqual(["c", "d"]);
    expect(page.some((id) => id <= "b")).toBe(false);

    const summary = summarizeBatch([
      { id: "c", ok: false },
      { id: "d", ok: true },
    ]);
    expect(summary.failedIds).toEqual(["c"]);
    expect(summary.resumeAfter).toBe("d");
  });
});

describe("writeBlobFile", () => {
  it("renames a complete body into place and leaves no partial", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "blob-write-"));
    dirs.push(dir);
    const filePath = path.join(dir, "receipts", "file.pdf");
    const body = Buffer.from("receipt-bytes");

    await writeBlobFile(filePath, body, String(body.length));

    expect(await readFile(filePath)).toEqual(body);
    const names = await readdir(path.dirname(filePath));
    expect(names.some((name) => name.includes(".partial"))).toBe(false);
  });

  it("does not create the final file when content-length does not match", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "blob-write-"));
    dirs.push(dir);
    const filePath = path.join(dir, "file.pdf");

    await expect(writeBlobFile(filePath, Buffer.from("short"), "99")).rejects.toThrow(
      /content-length/,
    );
    await expect(stat(filePath)).rejects.toThrow();
  });
});
