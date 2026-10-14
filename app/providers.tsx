"use client";

import "@rainbow-me/rainbowkit/styles.css";

import {
    RainbowKitProvider,
    darkTheme,
    lightTheme,
} from "@rainbow-me/rainbowkit";

import { QueryClient,
    QueryClientProvider } from "@tanstack/react-query";

import { WagmiProvider } from "wagmi";
import { Toaster } from "sonner";

import { config } from "@/lib/wagmi";
import { ThemeProvider, useThemePreference } from "@/components/theme-provider";

const queryClient = new QueryClient();

function ThemedProviders({ children }: { children: React.ReactNode }) {
    const { resolvedTheme } = useThemePreference();
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider
                    theme={resolvedTheme === "dark" ? darkTheme() : lightTheme()}
                >
                    {children}
                </RainbowKitProvider>
            </QueryClientProvider>
            <Toaster
                richColors
                position="bottom-right"
                theme={resolvedTheme}
            />
        </WagmiProvider>
    );
}

export function Providers({ children, }: { children:React.ReactNode; }) {
    return (
        <ThemeProvider>
            <ThemedProviders>{children}</ThemedProviders>
        </ThemeProvider>
    );
}

    