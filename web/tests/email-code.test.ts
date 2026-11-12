import { test } from "node:test";
import assert from "node:assert/strict";
import { hashEmailCode, newEmailCode, normalizeEmailCode } from "../lib/email-code-core.ts";
import { codeEmail, maskEmail } from "../lib/email.ts";

test("e-mail codes are 6 digits, leading zeros kept", () => {
  for (let i = 0; i < 2000; i++) assert.match(newEmailCode(), /^\d{6}$/);
});

test("typed codes accept spaces and a dash, nothing else", () => {
  assert.equal(normalizeEmailCode("123 456"), "123456");
  assert.equal(normalizeEmailCode(" 012-345 "), "012345");
  assert.equal(normalizeEmailCode("12345"), null);
  assert.equal(normalizeEmailCode("12345a"), null);
  assert.equal(normalizeEmailCode("K7QD-M2XP"), null);
});

test("the stored hash is bound to user, purpose and server secret", () => {
  const h = hashEmailCode(7, "login", "123456", "s1");
  assert.equal(h, hashEmailCode(7, "login", "123456", "s1"));
  assert.notEqual(h, hashEmailCode(8, "login", "123456", "s1"));
  assert.notEqual(h, hashEmailCode(7, "setup", "123456", "s1"));
  assert.notEqual(h, hashEmailCode(7, "login", "123456", "s2"));
  assert.ok(!h.includes("123456"));
});

test("the message shows the code and escapes the name", () => {
  const m = codeEmail("042917", "login", "<b>Ana</b> Souza");
  assert.match(m.subject, /^042 917 /);
  assert.ok(m.html.includes("042 917") && m.text.includes("042 917"));
  assert.ok(m.html.includes("&lt;b&gt;Ana&lt;/b&gt;") && !m.html.includes("<b>Ana</b>"));
  assert.match(m.text, /10 minutos/);
});

test("masked addresses keep the domain", () => {
  assert.equal(maskEmail("alex@somainfo.com.br"), "al***@somainfo.com.br");
  assert.equal(maskEmail("a@b.co"), "a***@b.co");
});
