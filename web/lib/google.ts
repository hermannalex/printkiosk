import { createHash, randomBytes } from "node:crypto";

/**
 * "Entrar com Google": OpenID Connect, authorization-code flow with PKCE, state and nonce.
 * The ID token comes straight from Google's token endpoint over TLS, authenticated with our client
 * secret, so (OIDC Core 3.1.3.7) its claims are checked — issuer, audience, expiry, nonce,
 * verified e-mail — without fetching Google's signing keys.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const googleClientId = () => (process.env.GOOGLE_CLIENT_ID ?? "").trim();
const clientSecret = () => (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
export const googleEnabled = () => !!googleClientId() && !!clientSecret();
export const redirectUri = () => `${(process.env.APP_URL || "https://quioco.vercel.app").replace(/\/$/, "")}/api/auth/google/callback`;

const b64url = (b: Buffer) => b.toString("base64url");

export type GoogleStart = { url: string; cookie: string };

/** The Google URL to send the browser to, and the value to keep in a short cookie until it comes back. */
export function startGoogle(intent: "entrar" | "cadastro"): GoogleStart {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `${AUTH_URL}?${params}`, cookie: [state, nonce, verifier, intent].join(".") };
}

export type GoogleProfile = { sub: string; email: string; name: string; intent: "entrar" | "cadastro" };

export function readCookie(value: string | undefined): { state: string; nonce: string; verifier: string; intent: "entrar" | "cadastro" } | null {
  const [state, nonce, verifier, intent] = (value ?? "").split(".");
  if (!state || !nonce || !verifier || (intent !== "entrar" && intent !== "cadastro")) return null;
  return { state, nonce, verifier, intent };
}

/** Exchanges the code; returns the verified profile, or throws with a reason for the audit log. */
export async function finishGoogle(code: string, verifier: string, nonce: string): Promise<{ sub: string; email: string; name: string }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!response.ok || !body.id_token) throw new Error(`token: ${body.error ?? response.status}`);
  return checkIdToken(body.id_token, googleClientId(), nonce);
}

/** Claims check, pure so it is unit-tested. */
export function checkIdToken(idToken: string, clientId: string, nonce: string, nowMs = Date.now()) {
  const part = idToken.split(".")[1];
  if (!part) throw new Error("id_token malformado");
  const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("iss");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error("aud");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs - 60_000) throw new Error("expirado");
  if (claims.nonce !== nonce) throw new Error("nonce");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("e-mail não verificado");
  const email = String(claims.email ?? "").toLowerCase().slice(0, 254);
  if (!claims.sub || !email) throw new Error("sem e-mail");
  return { sub: String(claims.sub).slice(0, 64), email, name: String(claims.name || email.split("@")[0]).slice(0, 80) };
}
