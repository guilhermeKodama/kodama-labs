import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { env } from "@/env";

let cachedClient: S3Client | null | undefined;

export interface S3Config {
  client: S3Client;
  bucket: string;
}

export function getS3Client(): S3Config | null {
  if (cachedClient !== undefined) {
    return cachedClient === null ? null : { client: cachedClient, bucket: env.S3_BUCKET! };
  }

  if (
    !env.S3_BUCKET ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY ||
    !env.S3_REGION
  ) {
    cachedClient = null;
    return null;
  }

  cachedClient = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  return { client: cachedClient, bucket: env.S3_BUCKET };
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string,
): Promise<void> {
  const cfg = getS3Client();
  if (!cfg) throw new Error("S3 client not configured");
  await cfg.client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function headObject(
  key: string,
): Promise<{ size: number; etag?: string } | null> {
  const cfg = getS3Client();
  if (!cfg) return null;
  try {
    const res = await cfg.client.send(
      new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    return { size: res.ContentLength ?? 0, etag: res.ETag };
  } catch (err) {
    if (
      err instanceof Error &&
      ("name" in err) &&
      (err.name === "NotFound" || err.name === "NoSuchKey")
    ) {
      return null;
    }
    throw err;
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const cfg = getS3Client();
  if (!cfg) return null;
  try {
    const res = await cfg.client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    if (!res.Body) return null;
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (
      err instanceof Error &&
      ("name" in err) &&
      (err.name === "NoSuchKey" || err.name === "NotFound")
    ) {
      return null;
    }
    throw err;
  }
}

export async function getSignedDownloadUrl(
  key: string,
  expiresInSec: number = 300,
): Promise<string | null> {
  const cfg = getS3Client();
  if (!cfg) return null;
  return getSignedUrl(
    cfg.client,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    { expiresIn: expiresInSec },
  );
}

export function buildDocumentStorageKey(
  procurementId: string,
  sequencial: number,
  title: string,
  extension: string,
): string {
  const safeExt = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `procurements/${procurementId}/${sequencial}-${slug || "doc"}.${safeExt}`;
}
