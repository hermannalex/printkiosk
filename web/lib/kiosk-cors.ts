import { NextResponse } from "next/server";

/**
 * The web station (https://app.imprime.ai) is a different origin from this API, so the browser
 * asks permission first. Only the station's own origin (and the ones listed in KIOSK_WEB_ORIGINS,
 * comma separated, for tests) gets it. The Android and iOS apps are not browsers and ignore CORS.
 */
const ORIGINS = new Set(
  ["https://app.imprime.ai", ...(process.env.KIOSK_WEB_ORIGINS ?? "").split(",")].map((o) => o.trim()).filter(Boolean),
);

export function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = request.headers.get("origin");
  if (origin && ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function withCors(request: Request, response: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders(request))) response.headers.set(key, value);
  return response;
}

export function reply(request: Request, body: unknown, status = 200): Response {
  return withCors(request, NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }));
}
