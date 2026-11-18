import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STORE_CONFIG, priceItem, sanitizeStoreConfig } from "../lib/store-price.ts";

const config = sanitizeStoreConfig({
  sizes: [
    { id: "a4", name: "A4", enabled: true, pb: 50, color: 150 },
    { id: "foto", name: "Foto 10x15", enabled: true, pb: null, color: 250 },
    { id: "a3", name: "A3", enabled: false, pb: 150, color: 400 },
  ],
  extras: [
    { id: "espiral", name: "Espiral", enabled: true, cents: 500, unit: "copy" },
    { id: "foto", name: "Papel foto", enabled: true, cents: 100, unit: "page" },
    { id: "capa", name: "Capa", enabled: true, cents: 300, unit: "file" },
    { id: "off", name: "Desligado", enabled: false, cents: 1, unit: "file" },
  ],
});

test("base price is pages × copies × price per page", () => {
  assert.deepEqual(priceItem(config, { pages: 10, paper: "a4", color: false, copies: 2, extras: [] }), { cents: 1000 });
  assert.deepEqual(priceItem(config, { pages: 10, paper: "a4", color: true, copies: 1, extras: [] }), { cents: 1500 });
});

test("extras are added per page, per copy or once per file", () => {
  // 3 pages × 2 copies × 50 = 300; espiral 500 × 2 = 1000; papel 100 × 6 = 600; capa 300
  assert.deepEqual(priceItem(config, { pages: 3, paper: "a4", color: false, copies: 2, extras: ["espiral", "foto", "capa", "espiral"] }), { cents: 2200 });
});

test("choices the store does not offer are refused", () => {
  assert.ok("error" in priceItem(config, { pages: 1, paper: "foto", color: false, copies: 1, extras: [] }));
  assert.ok("error" in priceItem(config, { pages: 1, paper: "a3", color: false, copies: 1, extras: [] }));
  assert.ok("error" in priceItem(config, { pages: 1, paper: "a4", color: false, copies: 1, extras: ["off"] }));
  assert.ok("error" in priceItem(config, { pages: 1, paper: "a4", color: false, copies: 0, extras: [] }));
  assert.ok("error" in priceItem(config, { pages: 1, paper: "a4", color: false, copies: 101, extras: [] }));
});

test("bad rows are dropped and a missing config falls back to the default", () => {
  const clean = sanitizeStoreConfig({ sizes: [{ name: "  ", pb: 1 }, { name: "Sem preço" }, { name: "Ok <b>", pb: "70", color: -5 }], extras: [{ name: "x", cents: "abc" }] });
  assert.deepEqual(clean.sizes, [{ id: "ok-b", name: "Ok b", enabled: false, pb: 70, color: null }]);
  assert.deepEqual(clean.extras, []);
  assert.deepEqual(sanitizeStoreConfig(null), DEFAULT_STORE_CONFIG);
});
