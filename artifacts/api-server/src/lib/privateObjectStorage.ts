import { randomUUID } from "node:crypto";

const SIDECAR_URL = "http://127.0.0.1:1106";

function storageLocation() {
  const location = process.env.PRIVATE_OBJECT_DIR;
  if (!location) throw new Error("Private upload storage is not configured.");
  const segments = location.replace(/^\/+/, "").split("/").filter(Boolean);
  const [bucketName, ...prefix] = segments;
  if (!bucketName) throw new Error("Private upload storage is not configured.");
  return { bucketName, prefix: prefix.join("/") };
}

async function signedUrl(objectName: string, method: "GET" | "PUT") {
  const { bucketName } = storageLocation();
  const response = await fetch(`${SIDECAR_URL}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Private upload storage could not sign the ${method} request (${response.status}).`);
  const result = await response.json() as { signed_url?: string };
  if (!result.signed_url) throw new Error("Private upload storage did not return a signed URL.");
  return result.signed_url;
}

function objectName(key: string) {
  const { prefix } = storageLocation();
  return [prefix, "callsheet", key].filter(Boolean).join("/");
}

export async function savePrivateScreenplay(file: { buffer: Buffer; originalname: string; mimetype: string }) {
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "screenplay.pdf";
  const key = `${randomUUID()}-${safeName}`;
  const response = await fetch(await signedUrl(objectName(key), "PUT"), {
    method: "PUT",
    headers: { "Content-Type": file.mimetype || "application/octet-stream" },
    body: file.buffer,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Private upload storage rejected the screenplay (${response.status}).`);
  return key;
}

export async function readPrivateScreenplay(key: string) {
  const response = await fetch(await signedUrl(objectName(key), "GET"), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Saved screenplay could not be read from private storage (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}