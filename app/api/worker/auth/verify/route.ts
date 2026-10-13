import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAddress, isHex, verifyMessage } from "viem";
import {
  createWorkerSessionToken,
  getWorkerSessionChallengeMessage,
  isCurrentWorkerAuthChallenge,
  WORKER_SESSION_COOKIE,
  WORKER_SESSION_TTL_SECONDS,
} from "@/lib/worker-session-auth";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(request: Request) {
  try {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) return NextResponse.json({ error: "Worker session signing is unavailable" }, { status: 503 });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: "Wallet authorization request origin is invalid" }, { status: 403 });
    }
    const body = await request.json();
    const walletInput = body?.worker_address;
    const nonce = body?.nonce;
    const expiresAt = body?.expires_at;
    const signature = body?.signature;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof walletInput !== "string" || !isAddress(walletInput, { strict: false }) ||
        typeof nonce !== "string" || !/^[0-9a-f]{64}$/.test(nonce) || typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt)) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !isHex(signature)) {
      return NextResponse.json({ error: "Valid wallet authorization fields are required" }, { status: 400 });
    }
    const workerAddress = walletInput.toLowerCase();
    const { data: challenge, error: lookupError } = await supabase.from("worker_auth_challenges")
      .select("nonce, worker_address, expires_at, consumed_at")
      .eq("nonce", nonce)
      .eq("worker_address", workerAddress)
      .maybeSingle();
    if (lookupError) {
      console.error("Worker auth challenge lookup failed", lookupError.code ?? "DatabaseError");
      return NextResponse.json({ error: "Unable to verify wallet authorization" }, { status: 503 });
    }
    if (!isCurrentWorkerAuthChallenge(challenge, workerAddress, expiresAt) ||
        !await verifyMessage({ address: walletInput, message: getWorkerSessionChallengeMessage(workerAddress, nonce, expiresAt), signature: signature as `0x${string}` })) {
      return NextResponse.json({ error: "Wallet authorization is invalid, expired, or already used" }, { status: 401 });
    }

    const consumedAt = new Date().toISOString();
    const { data: consumed, error: consumeError } = await supabase.from("worker_auth_challenges")
      .update({ consumed_at: consumedAt })
      .eq("nonce", nonce)
      .eq("worker_address", workerAddress)
      .is("consumed_at", null)
      .gt("expires_at", consumedAt)
      .select("nonce")
      .maybeSingle();
    if (consumeError) {
      console.error("Worker auth challenge consumption failed", consumeError.code ?? "DatabaseError");
      return NextResponse.json({ error: "Unable to complete wallet authorization" }, { status: 503 });
    }
    if (!consumed) return NextResponse.json({ error: "Wallet authorization is invalid, expired, or already used" }, { status: 401 });

    const expires = Math.floor(Date.now() / 1000) + WORKER_SESSION_TTL_SECONDS;
    const token = createWorkerSessionToken(workerAddress, expires, secret);
    const response = NextResponse.json({ worker_address: workerAddress, expires_at: new Date(expires * 1000).toISOString() }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(WORKER_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: WORKER_SESSION_TTL_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to complete wallet authorization" }, { status: 400 });
  }
}
