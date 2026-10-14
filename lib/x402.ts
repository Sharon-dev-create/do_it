/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { createClient } from "@supabase/supabase-js";
import { connection, NextRequest, NextResponse } from "next/server";
import { assertGatewayAvailable, SERVER_ARC_NETWORK_CONFIG } from "@/lib/arc-network-server";
import { assertPaymentNetwork } from "@/lib/arc-network";
import {
  getGatewayChainConfig,
  getGatewayFacilitatorUrl,
  getGatewaySellerAddress,
  getSupportedGatewayExtra,
  gatewayRequirementsMatch,
} from "@/lib/gateway-network";
import { isAddress, parseUnits } from "viem";

const facilitator = new BatchFacilitatorClient({
  url: getGatewayFacilitatorUrl(SERVER_ARC_NETWORK_CONFIG.name),
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface PaymentPayload {
  x402Version: number;
  resource?: { url: string; description: string; mimeType: string };
  accepted?: Record<string, unknown>;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

function buildPaymentRequirements(
  price: string,
  extra: Record<string, unknown>,
) {
  const amount = parseUnits(price.replace(/^\$/, ""), 6);
  if (amount <= 0n) throw new Error("x402 payment price must be greater than zero.");
  const chain = getGatewayChainConfig(SERVER_ARC_NETWORK_CONFIG.name);
  return {
    scheme: "exact" as const,
    network: `eip155:${chain.chain.id}`,
    asset: chain.usdc,
    amount: amount.toString(),
    payTo: getGatewaySellerAddress(SERVER_ARC_NETWORK_CONFIG.name),
    maxTimeoutSeconds: 691200,
    extra,
  };
}

/**
 * Wraps a Next.js route handler with Circle Gateway payment verification.
 *
 * Builds server-authoritative requirements from Circle's currently advertised
 * Gateway payment kind before verifying and settling each payment.
 */
export function withGateway(
  handler: (req: NextRequest) => Promise<NextResponse>,
  price: string,
  endpoint: string,
) {
  return async (req: NextRequest) => {
    await connection();
    const paymentSignature = req.headers.get("payment-signature");
    let requirements: ReturnType<typeof buildPaymentRequirements>;
    try {
      assertGatewayAvailable();
      const chain = getGatewayChainConfig(SERVER_ARC_NETWORK_CONFIG.name);
      const supported = await facilitator.getSupported();
      const extra = getSupportedGatewayExtra(supported.kinds, chain);
      requirements = buildPaymentRequirements(price, extra);
      assertPaymentNetwork(SERVER_ARC_NETWORK_CONFIG.name, requirements.network);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[x402] Gateway configuration/support check failed:", message);
      return NextResponse.json(
        { error: "Circle Gateway does not currently support the configured Arc payment path." },
        { status: 503 },
      );
    }
    // No payment — return 402 with Gateway batching payment requirements
    if (!paymentSignature) {
      console.log(`[x402] 402 Payment Required: ${endpoint}`);

      const paymentRequired = {
        x402Version: 2,
        resource: {
          url: endpoint,
          description: `Paid resource (${price} USDC)`,
          mimeType: "application/json",
        },
        accepts: [requirements],
      };

      return new NextResponse(JSON.stringify({}), {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": Buffer.from(
            JSON.stringify(paymentRequired),
          ).toString("base64"),
        },
      });
    }

    // Payment present — verify and settle via Circle Gateway
    try {
      const paymentPayload: PaymentPayload = JSON.parse(
        Buffer.from(paymentSignature, "base64").toString("utf-8"),
      );

      if (
        paymentPayload.x402Version !== 2 ||
        !gatewayRequirementsMatch(paymentPayload.accepted, requirements)
      ) {
        return NextResponse.json(
          { error: "Payment requirements do not match the server-authorized Arc payment." },
          { status: 402 },
        );
      }

      const verifyResult = await facilitator.verify(
        paymentPayload,
        requirements,
      );

      if (!verifyResult.isValid) {
        return NextResponse.json(
          {
            error: "Payment verification failed",
            reason: verifyResult.invalidReason,
          },
          { status: 402 },
        );
      }

      const settleResult = await facilitator.settle(
        paymentPayload,
        requirements,
      );

      if (
        !settleResult.success ||
        settleResult.network !== requirements.network ||
        typeof settleResult.transaction !== "string" ||
        !settleResult.transaction
      ) {
        console.error(
          `[x402] Settlement failed for ${endpoint}: ${settleResult.errorReason}`,
        );
        return NextResponse.json(
          {
            error: "Payment settlement failed",
            reason: settleResult.errorReason,
          },
          { status: 402 },
        );
      }

      // Record payment event in Supabase
      const amountUsdc = (
        Number(requirements.amount) / 1e6
      ).toString();
      const payer = settleResult.payer ?? verifyResult.payer ?? "unknown";
      if (!isAddress(payer)) {
        return NextResponse.json(
          { error: "Circle Gateway returned an invalid payment payer address." },
          { status: 502 },
        );
      }

      const { error } = await supabase.from("payment_events").insert({
        endpoint,
        payer,
        amount_usdc: amountUsdc,
        network: requirements.network,
        gateway_tx: settleResult.transaction ?? null,
        raw: { requirements, settleResult },
      });

      if (error) {
        console.error("Failed to record payment event:", error.message);
      }

      console.log(
        `[x402] Payment settled: ${endpoint} — ${amountUsdc} USDC from ${payer}`,
      );

      // Call the actual route handler
      const response = await handler(req);

      // Forward settlement info to the client
      const settleResponseHeader = Buffer.from(
        JSON.stringify({
          success: true,
          transaction: settleResult.transaction,
          network: requirements.network,
          payer,
        }),
      ).toString("base64");

      response.headers.set("PAYMENT-RESPONSE", settleResponseHeader);
      return response;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error("[x402] Payment processing error:", message);
      return NextResponse.json(
        { error: "Payment processing error", message },
        { status: 500 },
      );
    }
  };
}
