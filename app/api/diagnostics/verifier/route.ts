import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";

export const dynamic = "force-dynamic";

const EXPECTED_VERIFIER = "0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E";
const PRIVATE_KEY_FORMAT = /^0x[0-9a-fA-F]{64}$/;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  });
}

function isProtectedProductionHost(request: Request) {
  if (process.env.VERCEL_ENV !== "production") return false;

  const allowedHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => host.toLowerCase());

  return allowedHosts.includes(new URL(request.url).host.toLowerCase());
}

function methodNotAllowed() {
  return jsonResponse(
    { error: "Method not allowed" },
    405,
    { Allow: "GET" },
  );
}

export async function GET(request: Request) {
  // Vercel Authentication Protection covers deployment and branch URLs, but
  // not this project's public custom alias. Only run on the protected hosts.
  if (!isProtectedProductionHost(request)) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const key = process.env.DOIT_VERIFIER_PRIVATE_KEY;
  const configured = typeof key === "string" && key.length > 0;
  const wellFormed = configured && PRIVATE_KEY_FORMAT.test(key);
  let matchesExpectedVerifier = false;

  if (wellFormed) {
    try {
      matchesExpectedVerifier =
        privateKeyToAccount(key as `0x${string}`).address.toLowerCase() ===
        EXPECTED_VERIFIER.toLowerCase();
    } catch {
      // Do not expose derivation errors or secret material.
    }
  }

  return jsonResponse({ configured, wellFormed, matchesExpectedVerifier });
}

export async function HEAD() {
  return methodNotAllowed();
}

export async function POST() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return methodNotAllowed();
}
