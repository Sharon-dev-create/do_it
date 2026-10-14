import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAddress } from "viem";
import { getWorkerWithdrawalChallengeMessage } from "@/lib/worker-withdrawal-auth";
import { ARC_CHAIN_ID } from "@/lib/escrow-v2-server";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A valid worker wallet is required" }, { status: 400 });
    }
    const workerAddress = body?.worker_address;
    if (typeof workerAddress !== "string" || !isAddress(workerAddress, { strict: false })) {
      return NextResponse.json({ error: "A valid worker wallet is required" }, { status: 400 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
    const nonce = randomBytes(32).toString("hex");
    const normalizedAddress = workerAddress.toLowerCase();

    const { error: cleanupError } = await supabase.from("worker_withdrawal_auth_challenges").delete().lt("expires_at", now.toISOString());
    if (cleanupError) {
      console.error("Expired worker withdrawal challenge cleanup failed", cleanupError.code ?? "DatabaseError");
      return NextResponse.json({ error: "Unable to create a wallet authorization challenge" }, { status: 503 });
    }
    const { data: savedChallenge, error } = await supabase.from("worker_withdrawal_auth_challenges").insert({
      nonce,
      worker_address: normalizedAddress,
      expires_at: expiresAt,
    }).select("expires_at").single();
    if (error || !savedChallenge) return NextResponse.json({ error: "Unable to create a wallet authorization challenge" }, { status: 500 });
    const savedExpiry = savedChallenge.expires_at;

    return NextResponse.json({
      nonce,
      expiresAt: savedExpiry,
      message: getWorkerWithdrawalChallengeMessage(normalizedAddress, nonce, savedExpiry, ARC_CHAIN_ID),
    });
  } catch {
    return NextResponse.json({ error: "Unable to create a wallet authorization challenge" }, { status: 500 });
  }
}
