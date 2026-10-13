import { cookies } from "next/headers";
import { getWorkerAddressFromSessionToken, WORKER_SESSION_COOKIE } from "@/lib/worker-session-auth";

export async function getCreatorWallet() {
  const cookieStore = await cookies();
  return getWorkerAddressFromSessionToken(
    cookieStore.get(WORKER_SESSION_COOKIE)?.value,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
