import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET must be set (16+ characters) in production");
  }
  return "dev-only-secret-do-not-use-in-production";
}

const key = () => createHash("sha256").update(secret()).digest();

/** AES-256-GCM. Used for OAuth tokens at rest. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(enc: string): string {
  const buf = Buffer.from(enc, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  return createHmac("sha256", key()).update(value).digest("base64url");
}

export function verify(value: string, signature: string): boolean {
  const a = Buffer.from(sign(value));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
export const newId = () => randomBytes(12).toString("base64url");
