"use node";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fail } from "./platform";

function encryptionKey() {
  const value = process.env.CONNECTION_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    return fail(
      "Secure storage is temporarily unavailable. Please try again later.",
    );
  return Buffer.from(value, "hex");
}
export function sealCredential(secret: string, binding: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function openCredential(envelope: string, binding: string) {
  try {
    const [version, iv, tag, ciphertext] = envelope.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return fail(
      "The stored connection could not be decrypted. Reconnect the project in Settings.",
    );
  }
}
