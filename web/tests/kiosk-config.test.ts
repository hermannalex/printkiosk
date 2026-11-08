import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, effectiveConfig, sanitizeConfig } from "../lib/kiosk-config.ts";

test("sanitizeConfig keeps valid values and drops the rest", () => {
  const out = sanitizeConfig({ pricePerPageCents: 50, maxCopies: 99, idleTimeoutSeconds: 45, payerEmail: "Loja@X.com", evil: 1, wifiName: " Loja " });
  assert.deepEqual(out, { pricePerPageCents: 50, payerEmail: "loja@x.com", wifiName: "Loja" });
});

test("dashboard config wins over what the kiosk reported, defaults fill the gaps", () => {
  const c = effectiveConfig({ pricePerPageCents: 75 }, { pricePerPageCents: 20, maxItems: 5 });
  assert.equal(c.pricePerPageCents, 75);
  assert.equal(c.maxItems, 5);
  assert.equal(c.maxCopies, DEFAULT_CONFIG.maxCopies);
});
