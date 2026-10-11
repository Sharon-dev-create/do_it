import { NextResponse } from "next/server";
import { getV2TestWorkerDiagnostic } from "@/lib/v2-test-workers";

const WORKER_TO_CHECK = "0x4686a159487a97F8b2747485eF0653568aa6d521";
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json; charset=utf-8",
};
type DiagnosticResult = { configured: boolean; workerAllowed: boolean };
const NEGATIVE_RESULT: DiagnosticResult = { configured: false, workerAllowed: false };

function isProtectedProductionHost(request: Request) {
  if (process.env.VERCEL_ENV !== "production") return false;

  const allowedHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => host.toLowerCase());

  const requestHost = request.headers.get("host")?.toLowerCase();
  return Boolean(requestHost && allowedHosts.includes(requestHost));
}

function jsonResponse(body: DiagnosticResult, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function handleUnsupportedMethod(request: Request) {
  if (!isProtectedProductionHost(request)) return jsonResponse(NEGATIVE_RESULT, 404);
  return NextResponse.json(NEGATIVE_RESULT, {
    status: 405,
    headers: { ...RESPONSE_HEADERS, Allow: "GET" },
  });
}

export async function GET(request: Request) {
  // Vercel Authentication Protection covers deployment and branch URLs, but
  // not the public custom alias. Only execute on the protected Production hosts.
  if (!isProtectedProductionHost(request)) return jsonResponse(NEGATIVE_RESULT, 404);

  return jsonResponse(
    getV2TestWorkerDiagnostic(process.env.DOIT_V2_TEST_WORKERS, WORKER_TO_CHECK),
  );
}

export async function HEAD(request: Request) {
  return handleUnsupportedMethod(request);
}

export async function POST(request: Request) {
  return handleUnsupportedMethod(request);
}

export async function PUT(request: Request) {
  return handleUnsupportedMethod(request);
}

export async function PATCH(request: Request) {
  return handleUnsupportedMethod(request);
}

export async function DELETE(request: Request) {
  return handleUnsupportedMethod(request);
}

export async function OPTIONS(request: Request) {
  return handleUnsupportedMethod(request);
}
