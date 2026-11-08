import { constants, createCipheriv, createDecipheriv, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Backup file format (".qbk"), the same one tools/restaurar-backup.mjs reads:
 *   "QBK1" | key length (2 bytes) | AES key wrapped with RSA-OAEP-SHA256 | IV (12) | GCM tag (16) | data
 * The data is the gzipped JSON export, encrypted with a fresh AES-256-GCM key per backup.
 * The server only has the public key, so even a leaked backup store reveals nothing.
 */
export const MAGIC = Buffer.from("QBK1");

export function sealBackup(plain: Buffer, publicKeyPem: string): Buffer {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const data = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  const wrapped: Buffer = publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(wrapped.length);
  return Buffer.concat([MAGIC, length, wrapped, iv, cipher.getAuthTag(), data]);
}

export function openBackup(file: Buffer, privateKeyPem: string): Buffer {
  if (!file.subarray(0, 4).equals(MAGIC)) throw new Error("Não é um backup do Quioco.");
  const keyLength = file.readUInt16BE(4);
  let at = 6;
  const wrapped = file.subarray(at, (at += keyLength));
  const iv = file.subarray(at, (at += 12));
  const tag = file.subarray(at, (at += 16));
  const key: Buffer = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, wrapped);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  return gunzipSync(Buffer.concat([decipher.update(file.subarray(at)), decipher.final()]));
}
