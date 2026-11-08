import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIdToken, readCookie, startGoogle } from "../lib/google.ts";

const token = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const good = { iss: "https://accounts.google.com", aud: "cid", exp: 2_000_000_000, nonce: "n1", sub: "123", email: "Ana@Loja.com", email_verified: true, name: "Ana" };
const NOW = 1_900_000_000_000;

test("valid Google claims give the profile with a lower-case e-mail", () => {
  assert.deepEqual(checkIdToken(token(good), "cid", "n1", NOW), { sub: "123", email: "ana@loja.com", name: "Ana" });
});

test("wrong audience, nonce, issuer, expiry or unverified e-mail are refused", () => {
  assert.throws(() => checkIdToken(token(good), "other", "n1", NOW));
  assert.throws(() => checkIdToken(token(good), "cid", "n2", NOW));
  assert.throws(() => checkIdToken(token({ ...good, iss: "https://evil.example" }), "cid", "n1", NOW));
  assert.throws(() => checkIdToken(token({ ...good, exp: 1_000 }), "cid", "n1", NOW));
  assert.throws(() => checkIdToken(token({ ...good, email_verified: false }), "cid", "n1", NOW));
});

test("start URL carries PKCE and the cookie round-trips", () => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  const start = startGoogle("cadastro");
  const url = new URL(start.url);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "https://quioco.vercel.app/api/auth/google/callback");
  const saved = readCookie(start.cookie)!;
  assert.equal(saved.state, url.searchParams.get("state"));
  assert.equal(saved.intent, "cadastro");
  assert.equal(readCookie("a.b"), null);
});
