import "server-only";

import { NextResponse } from "next/server";

/**
 * CORS for the agent endpoints.
 *
 * These are called from a page on turo.com -- the operator's own
 * browser, reading their own conversations, because Cloudflare blocks
 * every automated browser we can point at the site. That makes them
 * cross-origin by necessity rather than by choice.
 *
 * Opening them is safe in a way that opening a session-authenticated
 * endpoint would not be. Authentication here is a Bearer token that
 * lives in the caller, not a cookie the browser attaches on its own,
 * so a hostile page cannot borrow the operator's identity by making a
 * request from their browser: it would have to already hold the token,
 * and if it holds the token it does not need CORS.
 *
 * `*` rather than an allowlist for the same reason. Restricting the
 * origin would suggest the origin is doing security work here, and it
 * is not -- the token is.
 */
export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function withCors<T>(body: T, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: corsHeaders() });
}

/** Preflight. Browsers send this before any request carrying an
 *  Authorization header, so without it the POST never happens. */
export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
