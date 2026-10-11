import { isAddress } from "viem";

export function isV2TestWorkerAllowed(
  address: string,
  configuredWorkers: string | undefined,
): boolean {
  if (!isAddress(address)) return false;
  if (!configuredWorkers) return false;

  return configuredWorkers
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes(address.toLowerCase());
}

export function getV2TestWorkerDiagnostic(
  configuredWorkers: string | undefined,
  address: string,
): { configured: boolean; workerAllowed: boolean } {
  return {
    configured: typeof configuredWorkers === "string" && configuredWorkers.length > 0,
    workerAllowed: isV2TestWorkerAllowed(address, configuredWorkers),
  };
}
