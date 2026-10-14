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
import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";
import { assertGatewayAvailable, SERVER_ARC_NETWORK_CONFIG } from "@/lib/arc-network-server";

const publicClient = createPublicClient({
  transport: http(SERVER_ARC_NETWORK_CONFIG.rpcUrl),
});

async function getWalletUsdcBalance(
  address: `0x${string}`,
): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: ARC_NETWORK_CONFIG.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });

    return formatUnits(balance, ARC_NETWORK_CONFIG.usdcDecimals);
  } catch (error) {
    console.error("Failed to fetch wallet USDC balance:", error);
    return "0";
  }
}

export async function GET() {
  try {
    assertGatewayAvailable();
  } catch {
    return NextResponse.json(
      { error: "Circle Gateway balance is unavailable on Arc Mainnet with the installed SDK." },
      { status: 503 },
    );
  }
  const address = process.env.SELLER_ADDRESS;

  if (!address) {
    return NextResponse.json(
      { error: "SELLER_ADDRESS not configured" },
      { status: 500 },
    );
  }

  const sellerAddress = address as `0x${string}`;

  try {
    const [gatewayResponse, walletBalance] = await Promise.all([
      fetch("https://gateway-api-testnet.circle.com/v1/balances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          token: "USDC",
          sources: [
            {
              domain: 26,
              depositor: sellerAddress,
            },
          ],
        }),
      }),

      getWalletUsdcBalance(sellerAddress),
    ]);

    if (!gatewayResponse.ok) {
      const text = await gatewayResponse.text();

      console.error(
        "Gateway API error:",
        gatewayResponse.status,
        text,
      );

      return NextResponse.json({
        wallet: {
          balance: walletBalance,
        },
        gateway: {
          total: "0",
          available: "0",
          pendingBatch: "0",
        },
      });
    }

    const data = await gatewayResponse.json();

    const bal = data.balances?.find(
      (b: { domain: number }) =>
        b.domain === 26,
    );

    const balance = bal?.balance ?? "0";
    const pendingBatch = bal?.pendingBatch ?? "0";

    const available =
      Math.max(
        0,
        parseFloat(balance) - parseFloat(pendingBatch),
      ).toFixed(6);

    return NextResponse.json({
      wallet: {
        balance: walletBalance,
      },
      gateway: {
        total: balance,
        available,
        pendingBatch,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error("Balance fetch error:", message);

    return NextResponse.json({
      wallet: {
        balance: "0",
      },
      gateway: {
        total: "0",
        available: "0",
        pendingBatch: "0",
      },
    });
  }
}
