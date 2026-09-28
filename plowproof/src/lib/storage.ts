import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/**
 * Photo storage.
 *   STORAGE_DRIVER=local  writes to ./.data/uploads (dev, or a single self-hosted box)
 *   STORAGE_DRIVER=s3     any S3-compatible bucket: Cloudflare R2, AWS S3, MinIO
 */
const DRIVER = process.env.STORAGE_DRIVER ?? "local";
const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

let s3: AwsClient | null = null;
function s3Client() {
  if (!s3) {
    const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
    if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !process.env.S3_ENDPOINT || !process.env.S3_BUCKET)
      throw new Error("S3 storage needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY");
    s3 = new AwsClient({
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      service: "s3",
      region: process.env.S3_REGION ?? "auto",
    });
  }
  return s3;
}
const s3Url = (key: string) =>
  `${process.env.S3_ENDPOINT!.replace(/\/$/, "")}/${process.env.S3_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

function localPath(key: string) {
  const full = path.join(LOCAL_ROOT, key);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (DRIVER === "s3") {
    const res = await s3Client().fetch(s3Url(key), {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "content-type": contentType },
    });
    if (!res.ok) throw new Error(`Photo upload failed: ${res.status} ${await res.text()}`);
    return;
  }
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (DRIVER === "s3") {
    const res = await s3Client().fetch(s3Url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Photo download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  try {
    return await readFile(localPath(key));
  } catch {
    return null;
  }
}
