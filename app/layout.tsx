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

import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "@/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  ...(process.env.VERCEL_URL
    ? { metadataBase: new URL(`https://${process.env.VERCEL_URL}`) }
    : {}),
  title: "Do-It",
  description:
    "A task marketplace for useful work and USDC micropayments on Arc.",
  icons: {
    icon: [{ url: "/brand/do-it-mark.png", type: "image/png" }],
    apple: [{ url: "/brand/do-it-mark.png", type: "image/png" }],
  },
  openGraph: {
    title: "Do-It",
    description:
      "A task marketplace for useful work and USDC micropayments on Arc.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Do-It",
    description:
      "A task marketplace for useful work and USDC micropayments on Arc.",
  },
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <Script
        id="doit-theme-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `(() => {
            let preference = "system";
            try {
              const saved = localStorage.getItem("doit-theme");
              if (saved === "light" || saved === "dark" || saved === "system") preference = saved;
            } catch {
              preference = "system";
            }
            const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
            document.documentElement.dataset.themePreference = preference;
            document.documentElement.dataset.theme = dark ? "dark" : "light";
          })();`,
        }}
      />
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
