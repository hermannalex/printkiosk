import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode, base32Encode, codeAt, hashRecoveryCode, newRecoveryCodes, newSecret,
  openSecret, otpauthUrl, sealSecret, verifyCode,
} from "../lib/totp.ts";

// RFC 6238, appendix B (SHA-1 seed "12345678901234567890"), last 6 of the 8 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("base32 round-trip and the RFC seed", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  const bytes = Buffer.from([0, 1, 2, 250, 255, 7, 99]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
});

test("RFC 6238 test vectors", () => {
  for (const [time, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]] as const) {
    assert.equal(codeAt(RFC_SECRET, Math.floor(time / 30)), code, `t=${time}`);
  }
});

test("verifyCode accepts ±1 step and refuses reuse", () => {
  const secret = newSecret();
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30000);
  assert.equal(verifyCode(secret, codeAt(secret, step), null, now), step);
  assert.equal(verifyCode(secret, codeAt(secret, step - 1), null, now), step - 1);
  assert.equal(verifyCode(secret, codeAt(secret, step + 1), null, now), step + 1);
  assert.equal(verifyCode(secret, codeAt(secret, step - 2), null, now), null);
  assert.equal(verifyCode(secret, codeAt(secret, step), step, now), null, "same step twice");
  assert.equal(verifyCode(secret, "12345", null, now), null);
  assert.equal(verifyCode(secret, "abcdef", null, now), null);
});

test("sealed secret opens only with the same master secret", () => {
  const sealed = sealSecret("JBSWY3DPEHPK3PXP", "a-very-long-session-secret");
  assert.equal(openSecret(sealed, "a-very-long-session-secret"), "JBSWY3DPEHPK3PXP");
  assert.throws(() => openSecret(sealed, "another-session-secret-123"));
  assert.notEqual(sealSecret("JBSWY3DPEHPK3PXP", "a-very-long-session-secret"), sealed, "fresh IV each time");
});

test("recovery codes are unique and hash the same with or without the dash", () => {
  const codes = newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].replace("-", "").toLowerCase()));
});

test("otpauth URL carries issuer and account", () => {
  const url = otpauthUrl("JBSWY3DPEHPK3PXP", "ana@loja.com");
  assert.ok(url.startsWith("otpauth://totp/imprime.ai%3Aana%40loja.com?"));
  assert.ok(url.includes("secret=JBSWY3DPEHPK3PXP") && url.includes("issuer=imprime.ai"));
});
