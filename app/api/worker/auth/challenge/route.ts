import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAddress } from "viem";
import { getWorkerSessionChallengeMessage } from "@/lib/worker-session-auth";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const wallet = body?.worker_address;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof wallet !== "string" || !isAddress(wallet, { strict: false })) {
      return NextResponse.json({ error: "A valid worker wallet is required" }, { status: 400 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
    const workerAddress = wallet.toLowerCase();
    const nonce = randomBytes(32).toString("hex");
    const { error: cleanupError } = await supabase.from("worker_auth_challenges").delete().lt("expires_at", now.toISOString());
    if (cleanupError) {
      console.error("Expired worker auth challenge cleanup failed", cleanupError.code ?? "DatabaseError");
      return NextResponse.json({ error: "Unable to start wallet authorization" }, { status: 503 });
    }
    const { data, error } = await supabase.from("worker_auth_challenges").insert({
      nonce,
      worker_address: workerAddress,
      expires_at: expiresAt,
    }).select("expires_at").single();
    if (error || !data) {
      console.error("Worker auth challenge creation failed", error?.code ?? "DatabaseError");
      return NextResponse.json({ error: "Unable to start wallet authorization" }, { status: 503 });
    }
    return NextResponse.json({
      nonce,
      expiresAt: data.expires_at,
      message: getWorkerSessionChallengeMessage(workerAddress, nonce, data.expires_at),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to start wallet authorization" }, { status: 400 });
  }
}
