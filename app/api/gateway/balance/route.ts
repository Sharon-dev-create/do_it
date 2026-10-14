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

import { NextResponse } from "next/server";
import { createPublicClient, http, formatUnits, erc20Abi, parseUnits } from "viem";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";
import { assertGatewayAvailable, SERVER_ARC_NETWORK_CONFIG } from "@/lib/arc-network-server";
import {
  getGatewayApiUrl,
  getGatewayChainConfig,
  getGatewaySellerAddress,
} from "@/lib/gateway-network";
import { assertArcChainId } from "@/lib/arc-network";

const gatewayChain = getGatewayChainConfig(SERVER_ARC_NETWORK_CONFIG.name);
const publicClient = createPublicClient({
  chain: gatewayChain.chain,
  transport: http(SERVER_ARC_NETWORK_CONFIG.rpcUrl),
});

async function getWalletUsdcBalance(address: `0x${string}`): Promise<string> {
  const balance = await publicClient.readContract({
    address: ARC_NETWORK_CONFIG.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  return formatUnits(balance, ARC_NETWORK_CONFIG.usdcDecimals);
}

export async function GET() {
  try {
    assertGatewayAvailable();
    const sellerAddress = getGatewaySellerAddress(SERVER_ARC_NETWORK_CONFIG.name);
    assertArcChainId(SERVER_ARC_NETWORK_CONFIG.name, await publicClient.getChainId());

    const [gatewayResponse, walletBalance] = await Promise.all([
      fetch(getGatewayApiUrl(SERVER_ARC_NETWORK_CONFIG.name, "/balances"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          token: "USDC",
          sources: [{ domain: gatewayChain.domain, depositor: sellerAddress }],
        }),
      }),
      getWalletUsdcBalance(sellerAddress),
    ]);

    if (!gatewayResponse.ok) {
      const text = await gatewayResponse.text();
      throw new Error(`Circle Gateway balance request failed (${gatewayResponse.status}): ${text}`);
    }

    const data = await gatewayResponse.json();
    const balanceRecord = data.balances?.find(
      (item: { domain: number }) => item.domain === gatewayChain.domain,
    );
    const balance = String(balanceRecord?.balance ?? "0");
    const pendingBatch = String(balanceRecord?.pendingBatch ?? "0");
    const availableUnits = parseUnits(balance, 6) - parseUnits(pendingBatch, 6);
    const available = formatUnits(availableUnits > 0n ? availableUnits : 0n, 6);

    return NextResponse.json({
      wallet: { balance: walletBalance },
      gateway: { total: balance, available, pendingBatch },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Gateway balance fetch failed:", message);
    return NextResponse.json(
      { error: "Unable to verify the seller's Arc and Gateway balances." },
      { status: 502 },
    );
  }
}
