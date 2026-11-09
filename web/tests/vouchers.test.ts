import { test } from "node:test";
import assert from "node:assert/strict";
import { newVoucherCode, normalizeVoucherCode, voucherStatus } from "../lib/vouchers.ts";

test("voucher codes are 10 unambiguous characters and survive retyping", () => {
  for (let i = 0; i < 200; i++) {
    const code = newVoucherCode();
    assert.match(code, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    assert.equal(normalizeVoucherCode(code.toLowerCase().replace("-", " ")), code);
  }
  assert.equal(normalizeVoucherCode("ABCDE-2345O"), null);
  assert.equal(normalizeVoucherCode("ABC"), null);
});

test("voucher status", () => {
  assert.equal(voucherStatus({ disabled: false, balance_cents: 500, expires_on: null }, "2026-11-09"), "ativo");
  assert.equal(voucherStatus({ disabled: false, balance_cents: 0, expires_on: null }, "2026-11-09"), "esgotado");
  assert.equal(voucherStatus({ disabled: false, balance_cents: 500, expires_on: "2026-11-08" }, "2026-11-09"), "vencido");
  assert.equal(voucherStatus({ disabled: true, balance_cents: 500, expires_on: null }, "2026-11-09"), "desativado");
});
