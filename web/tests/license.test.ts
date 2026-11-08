import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { dayNumber, hashSecret, makeActivationCode, normalizeStoreCode, pairingCode } from "../lib/license.ts";

test("store codes are normalised or refused", () => {
  assert.equal(normalizeStoreCode("abcd efgh"), "ABCD-EFGH");
  assert.equal(normalizeStoreCode("ABCD-EFG1"), null, "1 is not base32");
  assert.equal(normalizeStoreCode("ABC"), null);
});

test("day numbers count from 2024-01-01", () => {
  assert.equal(dayNumber("2024-01-01"), 0);
  assert.equal(dayNumber("2024-12-31"), 365);
});

test("activation code = payload + ECDSA signature the apps can verify", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.LICENSE_PRIVATE_KEY = privateKey.export({ type: "sec1", format: "pem" }).toString();
  const code = makeActivationCode("GJ6L-YMJU", "2026-12-31");
  assert.ok(code.startsWith("PK1-"));
  const raw = Buffer.from(code.slice(4), "base64url");
  const payload = raw.subarray(0, 8);
  assert.equal(payload[0], 1);
  assert.equal((payload[6] << 8) | payload[7], dayNumber("2026-12-31"));
  assert.ok(verify("sha256", payload, publicKey, raw.subarray(8)));
});

test("pairing code matches the apps' derivation (same value as the Kotlin test)", () => {
  assert.equal(pairingCode(hashSecret("teste-claude-0123456789")), "MBD-4D6");
});

import { parseBRL } from "../lib/format.ts";
test("parseBRL reads Brazilian amounts", () => {
  assert.equal(parseBRL("0,50"), 50);
  assert.equal(parseBRL("R$ 1,2"), 120);
  assert.equal(parseBRL("2"), 200);
  assert.equal(parseBRL("1.25"), 125);
  assert.equal(parseBRL("0"), 0);
  assert.equal(parseBRL("-1"), null);
  assert.equal(parseBRL("abc"), null);
  assert.equal(parseBRL("1,234"), null);
});
