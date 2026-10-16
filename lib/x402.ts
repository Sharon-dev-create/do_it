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
import { createHash } from "node:crypto";
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
import { executeX402PaymentFlow, type X402Intent, type X402SettlementResult } from "@/lib/x402-payment-flow";

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

interface AuthorizationPayload {
  from: string;
  to: string;
  value: string;
  nonce: string;
}

interface PreparedIntentRow {
  intent_id: string;
  intent_status: X402Intent["status"];
  response_status: number | null;
  response_body: unknown | null;
  provider_transfer_id: string | null;
  provider_status: string | null;
}

function asPreparedIntent(data: unknown): X402Intent {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("x402 intent preparation returned no row.");
  }
  const value = row as PreparedIntentRow;
  if (
    typeof value.intent_id !== "string" ||
    typeof value.intent_status !== "string"
  ) {
    throw new Error("x402 intent preparation returned an invalid row.");
  }
  return {
    id: value.intent_id,
    status: value.intent_status,
    response_status: value.response_status,
    response_body: value.response_body,
    provider_transfer_id: value.provider_transfer_id,
    provider_status: value.provider_status,
  };
}

function getAuthorization(paymentPayload: PaymentPayload): AuthorizationPayload | null {
  const authorization = paymentPayload.payload?.authorization;
  if (!authorization || typeof authorization !== "object") return null;
  const value = authorization as Record<string, unknown>;
  if (
    typeof value.from !== "string" ||
    typeof value.to !== "string" ||
    typeof value.value !== "string" ||
    typeof value.nonce !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.nonce) ||
    !isAddress(value.from) ||
    !isAddress(value.to)
  ) {
    return null;
  }
  return {
    from: value.from,
    to: value.to,
    value: value.value,
    nonce: value.nonce,
  };
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
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("[x402] Gateway configuration/support check failed:", {
        endpoint,
        errorName,
      });
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

      const authorization = getAuthorization(paymentPayload);
      if (!authorization) {
        return NextResponse.json(
          { error: "Payment authorization is malformed." },
          { status: 402 },
        );
      }

      if (!/^[0-9]+$/.test(authorization.value)) {
        return NextResponse.json(
          { error: "Payment authorization amount is malformed." },
          { status: 402 },
        );
      }
      const expectedAmount = BigInt(requirements.amount);
      if (
        BigInt(authorization.value) !== expectedAmount ||
        authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()
      ) {
        return NextResponse.json(
          { error: "Payment authorization does not match its required recipient or amount." },
          { status: 402 },
        );
      }

      const payer = authorization.from;

      const chainConfig = getGatewayChainConfig(SERVER_ARC_NETWORK_CONFIG.name);
      const verifyingContract = requirements.extra.verifyingContract;
      if (typeof verifyingContract !== "string" || !isAddress(verifyingContract)) {
        return NextResponse.json(
          { error: "Circle Gateway returned invalid authorization domain configuration." },
          { status: 503 },
        );
      }
      const requestHash = createHash("sha256")
        .update(req.method)
        .update("\n")
        .update(req.nextUrl.pathname)
        .update(req.nextUrl.search)
        .update("\n")
        .update(Buffer.from(await req.clone().arrayBuffer()))
        .digest("hex");

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
      if (
        verifyResult.payer &&
        (!isAddress(verifyResult.payer) ||
          verifyResult.payer.toLowerCase() !== payer.toLowerCase())
      ) {
        return NextResponse.json(
          { error: "Circle Gateway verified a different authorization payer." },
          { status: 402 },
        );
      }

      const { data: existingIntentData, error: existingIntentError } = await supabase.rpc(
        "get_x402_payment_intent",
        {
          p_network: requirements.network,
          p_domain_id: chainConfig.domain,
          p_verifying_contract: verifyingContract,
          p_payer: payer,
          p_authorization_nonce: authorization.nonce,
        },
      );
      if (existingIntentError) {
        console.error("x402 intent lookup failed:", {
          endpoint,
          code: existingIntentError.code,
        });
        return NextResponse.json(
          { error: "Unable to determine the existing payment state. Do not resubmit the authorization." },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      const existingIntent = Array.isArray(existingIntentData)
        ? existingIntentData[0]
        : null;

      if (existingIntent) {
        const sameContext =
          existingIntent.network === requirements.network &&
          existingIntent.domain_id === chainConfig.domain &&
          existingIntent.verifying_contract.toLowerCase() === verifyingContract.toLowerCase() &&
          existingIntent.payer.toLowerCase() === payer.toLowerCase() &&
          existingIntent.recipient.toLowerCase() === requirements.payTo.toLowerCase() &&
          existingIntent.token.toLowerCase() === requirements.asset.toLowerCase() &&
          String(existingIntent.amount_base_units) === requirements.amount &&
          existingIntent.authorization_nonce.toLowerCase() === authorization.nonce.toLowerCase() &&
          existingIntent.endpoint === endpoint &&
          existingIntent.request_hash === requestHash;
        if (!sameContext) {
          return NextResponse.json(
            { error: "This authorization is already bound to different payment requirements." },
            { status: 402 },
          );
        }
        if (existingIntent.status === "response_ready") {
          if (
            !existingIntent.provider_transfer_id ||
            typeof existingIntent.response_status !== "number" ||
            existingIntent.response_body === null
          ) {
            return NextResponse.json(
              { error: "Recorded payment response requires operator review." },
              { status: 503, headers: { "Cache-Control": "no-store" } },
            );
          }
          const response = NextResponse.json(existingIntent.response_body, {
            status: existingIntent.response_status,
          });
          response.headers.set(
            "PAYMENT-RESPONSE",
            Buffer.from(JSON.stringify({
              success: true,
              transaction: existingIntent.provider_transfer_id,
              network: requirements.network,
              payer,
            })).toString("base64"),
          );
          return response;
        }
        if (
          existingIntent.status !== "verified" &&
          existingIntent.status !== "provider_accepted"
        ) {
          return NextResponse.json(
            {
              error: "Payment processing is unresolved. Do not submit a new payment authorization.",
              status: existingIntent.status,
            },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      }

      const flow = await executeX402PaymentFlow({
        expectedNetwork: requirements.network,
        expectedPayer: payer,
        createPaymentResponse: (transferId) =>
          Buffer.from(JSON.stringify({
            success: true,
            transaction: transferId,
            network: requirements.network,
            payer,
          })).toString("base64"),
        prepare: async () => {
          const { data, error } = await supabase.rpc("prepare_x402_payment_intent", {
            p_network: requirements.network,
            p_domain_id: chainConfig.domain,
            p_verifying_contract: verifyingContract,
            p_payer: payer,
            p_recipient: requirements.payTo,
            p_token: requirements.asset,
            p_amount_base_units: requirements.amount,
            p_authorization_nonce: authorization.nonce,
            p_endpoint: endpoint,
            p_request_hash: requestHash,
          });
          if (error) throw new Error("Unable to prepare durable x402 payment intent.");
          return asPreparedIntent(data);
        },
        claim: async (intentId) => {
          const { data, error } = await supabase.rpc("claim_x402_payment_intent", {
            p_intent_id: intentId,
          });
          if (error) throw new Error("Unable to claim x402 payment intent.");
          const row = Array.isArray(data) ? data[0] : data;
          if (!row || typeof row !== "object") {
            throw new Error("x402 payment intent claim returned no state.");
          }
          const claim = row as { claimed: boolean; intent_status: X402Intent["status"] };
          return { claimed: claim.claimed, status: claim.intent_status };
        },
        settle: async () => {
          const result = await facilitator.settle(paymentPayload, requirements);
          return {
            success: result.success,
            network: result.network,
            transaction: result.transaction,
            payer: result.payer ?? payer,
            errorReason: result.errorReason,
          } satisfies X402SettlementResult;
        },
        markRecoveryPending: async (intentId, errorCode) => {
          const { error } = await supabase.rpc("mark_x402_payment_recovery_pending", {
            p_intent_id: intentId,
            p_error_code: errorCode,
          });
          if (error) throw new Error("Unable to persist x402 recovery state.");
        },
        recordProviderAcceptance: async (intentId, transferId) => {
          const { error } = await supabase.rpc("record_x402_provider_acceptance", {
            p_intent_id: intentId,
            p_provider_transfer_id: transferId,
            p_provider_status: null,
          });
          if (error) throw new Error("Unable to persist Circle x402 acceptance.");
        },
        buildResponse: async () => {
          const response = await handler(req);
          return {
            status: response.status,
            body: await response.clone().json(),
          };
        },
        saveResponse: async (intentId, status, body) => {
          const { data, error } = await supabase.rpc("save_x402_payment_response", {
            p_intent_id: intentId,
            p_response_status: status,
            p_response_body: body,
          });
          if (error) throw new Error("Unable to persist x402 response.");
          const row = Array.isArray(data) ? data[0] : data;
          if (!row || typeof row !== "object") {
            throw new Error("x402 response persistence returned no row.");
          }
          const saved = row as { response_status: number; response_body: unknown };
          return { status: saved.response_status, body: saved.response_body };
        },
        onRecoveryStateWriteFailure: (intentId, errorCode) => {
          console.error("x402 recovery state could not be persisted:", {
            intentId,
            errorCode,
          });
        },
        onPostAcceptanceFailure: (intentId, errorCode) => {
          console.error("x402 accepted payment is awaiting response recovery:", {
            intentId,
            errorCode,
          });
        },
      });

      if (flow.kind === "pending") {
        return NextResponse.json(
          {
            error: "Payment processing is unresolved. Do not submit a new payment authorization.",
            status: flow.status,
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }

      const response = NextResponse.json(flow.response.body, {
        status: flow.response.status,
      });
      response.headers.set("PAYMENT-RESPONSE", flow.response.paymentResponse);
      return response;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("[x402] Payment processing failed:", { endpoint, errorName });
      return NextResponse.json(
        { error: "Payment processing failed. The payment state may require reconciliation." },
        { status: 500 },
      );
    }
  };
}
