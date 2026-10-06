import { ipv4Fetch } from "./ipv4-fetch";

const originalFetch = globalThis.fetch;

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const arcRpcUrl = process.env.ARC_RPC_URL;

  if (arcRpcUrl && new URL(url).hostname === new URL(arcRpcUrl).hostname) {
    return ipv4Fetch(input as string | URL, init);
  }

  return originalFetch(input, init);
}) as typeof fetch;