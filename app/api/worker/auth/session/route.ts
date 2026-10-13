import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getWorkerAddressFromSessionToken, WORKER_SESSION_COOKIE } from "@/lib/worker-session-auth";

export async function GET() {
  const cookieStore = await cookies();
  const workerAddress = getWorkerAddressFromSessionToken(
    cookieStore.get(WORKER_SESSION_COOKIE)?.value,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  return NextResponse.json({ worker_address: workerAddress }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(WORKER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
