import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { openBackup as openInApp, sealBackup } from "../lib/backup-crypto.ts";
// @ts-ignore — plain JS tool, no types
import { openBackup as openInTool, toSql } from "../tools/restaurar-backup.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

test("backup opens with the private key, in the app and in the restore tool", () => {
  const plain = Buffer.from(JSON.stringify({ hello: "olá", n: 42 }));
  const file = sealBackup(plain, publicKey);
  assert.ok(!file.includes(plain), "data must not be readable");
  assert.deepEqual(openInApp(file, privateKey), plain);
  assert.deepEqual(openInTool(file, privateKey), plain);
});

test("a changed byte or the wrong key is refused", () => {
  const file = sealBackup(Buffer.from("segredo"), publicKey);
  const tampered = Buffer.from(file);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openInTool(tampered, privateKey));
  const other = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  assert.throws(() => openInTool(file, other.privateKey));
});

test("SQL export quotes text, arrays and json", () => {
  const sql = toSql({
    created_at: "2026-11-08T06:00:00Z",
    tables: { users: { columns: ["id", "name", "codes", "meta", "ok"], rows: [[1, "D'Ávila", ["a\"b", "c"], { x: 1 }, true]] } },
  });
  assert.match(sql, /values \(1, 'D''Ávila', '\{"a\\"b","c"\}', '\{"x":1\}', true\);/);
  assert.match(sql, /setval\(pg_get_serial_sequence\('users', 'id'\)/);
});
