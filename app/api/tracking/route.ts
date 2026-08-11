/**
 * Shiprocket tracking webhook proxy — MangaiMart.
 *
 * Shiprocket's panel points here; this hands the scan to the Supabase Edge
 * Function `shiprocket-webhook`, which is the only thing that writes to an
 * order (via apply_shipment_scan(), migration 0067). This file decides nothing
 * about an order. It authenticates, forwards bytes, and returns what came back.
 *
 * WHY A PROXY. The Edge Function is publicly callable, so a proxy buys exactly
 * one thing: the webhook URL Shiprocket holds is on our own domain, and the
 * Supabase project ref never leaves the server. Nothing else changes.
 *
 * SECURITY — read this before editing.
 * The upstream function's ONLY authentication is the `x-api-key` shared secret.
 * A proxy that injects that secret for whatever arrives is not a proxy, it is a
 * bypass: any anonymous caller could POST {"awb":"…","current_status":
 * "Delivered"}, the order would flip to delivered, delivered_at would stamp, the
 * payout hold would start, and api/run-payouts.js would send real money. AWBs
 * are not secret — buyers see their own on the tracking link.
 *
 * So this route re-checks the same secret on the way IN before attaching it on
 * the way OUT. The trust boundary stays where it was. Shiprocket presents the
 * token in the `x-api-key` header, or in `?token=` when a panel cannot set
 * custom headers — set whichever the panel supports to the SAME value as
 * SHIPROCKET_WEBHOOK_TOKEN and nothing else needs configuring.
 *
 * If you truly need an unauthenticated relay, set
 * SHIPROCKET_PROXY_ALLOW_UNAUTHENTICATED=true. Understand that this makes
 * "mark any order delivered and release its payout" an open endpoint.
 *
 * RETRIES. Shiprocket re-sends on any non-2xx, indefinitely. That is why the
 * upstream returns 200 for payloads it cannot use (unknown AWB, unrecognised
 * status) — those must not be retried. This layer therefore never invents a
 * 2xx and never rewrites the upstream status: a scan we failed to deliver
 * (timeout, network fault) returns 502/504 precisely so it IS retried, and a
 * bad secret returns 401 so a misconfigured panel is loud rather than silent.
 */

import { NextRequest, NextResponse } from "next/server";

// Never statically evaluated, never cached — this is a side-effecting endpoint.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-only. Route handlers are never bundled into the browser, and the name
 * carries no NEXT_PUBLIC_ prefix, so neither the URL nor the project ref can
 * reach the client. The literal is the fallback so a missing env var degrades
 * to "still works" rather than "webhook silently dead"; set the env var to
 * point at a different Supabase project without a redeploy of this file.
 */
const UPSTREAM_URL =
  process.env.SHIPROCKET_WEBHOOK_URL ??
  "https://mtxmuaskmyhnqczctwlp.supabase.co/functions/v1/shiprocket-webhook";

/** Shiprocket's own client gives up well before this. Long enough to absorb a
 *  cold start on the Edge Function, short enough to fail before the platform
 *  kills us mid-flight and turns a retryable 504 into an opaque error. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** A tracking scan is a few hundred bytes; a batch of them, a few kilobytes.
 *  256 KB is generous and still refuses to spend a function invocation
 *  streaming something that cannot be a webhook. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Constant-time compare. A plain `===` on a shared secret leaks its length and
 * matching prefix to a patient caller, and this secret is what stands between
 * the internet and marking orders delivered. Mirrors safeEqual() in
 * supabase/functions/shiprocket-webhook/index.ts deliberately — the two ends of
 * this hop should be checking the token the same way.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Structured, greppable, and never carrying the token or the payload — a scan
 *  body contains a buyer's delivery address. */
function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    scope: "shiprocket-proxy",
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  // Correlates the lines below with each other and with the upstream's logs
  // when a scan has to be chased. Not a security value.
  const requestId = crypto.randomUUID();

  const token = process.env.SHIPROCKET_WEBHOOK_TOKEN ?? "";
  if (!token) {
    // Refuse rather than forward `undefined` as the header: an unset secret
    // must fail here, loudly, not surface as a confusing 401 from upstream.
    log("error", "token_unset", { requestId });
    return jsonResponse({ error: "Webhook not configured" }, 503);
  }

  // ── Authenticate the caller ───────────────────────────────────────────────
  const allowUnauthenticated =
    process.env.SHIPROCKET_PROXY_ALLOW_UNAUTHENTICATED === "true";

  if (!allowUnauthenticated) {
    const presented =
      req.headers.get("x-api-key") ??
      req.nextUrl.searchParams.get("token") ??
      "";

    if (!safeEqual(presented, token)) {
      log("warn", "unauthorized", {
        requestId,
        presented: presented ? "mismatch" : "absent",
      });
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

  // ── Read the body verbatim ────────────────────────────────────────────────
  // As text, never parsed and re-serialised: the upstream reads Shiprocket's
  // fields defensively across API versions, and a round-trip through
  // JSON.parse would be a silent chance to drop or reshape one.
  let raw: string;
  try {
    raw = await req.text();
  } catch (err) {
    log("error", "body_read_failed", { requestId, message: describe(err) });
    return jsonResponse({ error: "Could not read request body" }, 400);
  }

  const size = Buffer.byteLength(raw, "utf8");
  if (size > MAX_BODY_BYTES) {
    log("warn", "body_too_large", { requestId, size });
    return jsonResponse({ error: "Payload too large" }, 413);
  }

  // ── Forward ───────────────────────────────────────────────────────────────
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": token,
      },
      body: raw,
      signal: timeout,
      // No caching layer may sit between us and a side-effecting endpoint.
      cache: "no-store",
    });
  } catch (err) {
    // A timeout and a DNS failure are both "the scan did not land". Return a
    // status Shiprocket retries on — dropping it here would lose the delivery
    // confirmation permanently, and with it the payout trigger.
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    log("error", timedOut ? "upstream_timeout" : "upstream_unreachable", {
      requestId,
      size,
      ms: Date.now() - startedAt,
      message: describe(err),
    });
    return jsonResponse(
      { error: timedOut ? "Upstream timed out" : "Upstream unreachable" },
      timedOut ? 504 : 502,
    );
  }

  // ── Return exactly what came back ─────────────────────────────────────────
  let responseBody: string;
  try {
    responseBody = await upstream.text();
  } catch (err) {
    log("error", "upstream_body_read_failed", {
      requestId,
      status: upstream.status,
      message: describe(err),
    });
    return jsonResponse({ error: "Upstream response unreadable" }, 502);
  }

  log(upstream.ok ? "info" : "warn", "forwarded", {
    requestId,
    size,
    status: upstream.status,
    ms: Date.now() - startedAt,
  });

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: {
      // Echo what upstream actually sent. It returns JSON on every path today,
      // but forcing the header would mislabel any future plain-text or empty
      // body — and a 204 legitimately carries no content type at all.
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** Health check. Deliberately says nothing about configuration state — whether
 *  the token is set is not a stranger's business. */
export async function GET(): Promise<NextResponse> {
  return jsonResponse({ message: "MangaiMart Tracking Webhook" }, 200);
}

/**
 * Every other method: the App Router answers an undefined export with 405 and
 * the correct `Allow` header on its own, so POST and GET above are the whole
 * surface. Nothing to add here — this note exists so the absence reads as
 * intentional rather than forgotten.
 */

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
