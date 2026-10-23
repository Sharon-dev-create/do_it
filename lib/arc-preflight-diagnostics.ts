export const ARC_PREFLIGHT_PUBLIC_ERROR =
  "Arc Testnet escrow is unavailable or misconfigured. Check the server deployment configuration.";

export const ARC_PREFLIGHT_DIAGNOSTIC_CODES = [
  "NETWORK_CONFIG_INVALID",
  "RPC_URL_MISSING",
  "RPC_URL_INVALID",
  "RPC_UNAVAILABLE",
  "RPC_WRONG_CHAIN",
  "ESCROW_CODE_MISSING",
  "VERIFIER_CONFIG_INVALID",
  "USDC_ADDRESS_INVALID",
  "USDC_DECIMALS_INVALID",
  "ESCROW_CONFIGURATION_INVALID",
  "PREFLIGHT_UNEXPECTED_ERROR",
] as const;

export type ArcPreflightDiagnosticCode = typeof ARC_PREFLIGHT_DIAGNOSTIC_CODES[number];

export const ARC_PREFLIGHT_STAGES = [
  "request",
  "network_config",
  "rpc_url",
  "rpc_chain_id",
  "escrow_code_read",
  "escrow_code_check",
  "verifier_config",
  "escrow_config_read",
  "usdc_address_check",
  "usdc_decimals_read",
  "usdc_decimals_check",
  "escrow_configuration_check",
  "unexpected",
] as const;

export type ArcPreflightStage = typeof ARC_PREFLIGHT_STAGES[number];

export class ArcPreflightError extends Error {
  constructor(
    readonly code: ArcPreflightDiagnosticCode,
    readonly stage: ArcPreflightStage,
    safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "ArcPreflightError";
  }
}

const STAGE_CODE: Record<ArcPreflightStage, ArcPreflightDiagnosticCode> = {
  request: "PREFLIGHT_UNEXPECTED_ERROR",
  network_config: "NETWORK_CONFIG_INVALID",
  rpc_url: "RPC_URL_INVALID",
  rpc_chain_id: "RPC_UNAVAILABLE",
  escrow_code_read: "RPC_UNAVAILABLE",
  escrow_code_check: "ESCROW_CODE_MISSING",
  verifier_config: "VERIFIER_CONFIG_INVALID",
  escrow_config_read: "RPC_UNAVAILABLE",
  usdc_address_check: "USDC_ADDRESS_INVALID",
  usdc_decimals_read: "RPC_UNAVAILABLE",
  usdc_decimals_check: "USDC_DECIMALS_INVALID",
  escrow_configuration_check: "ESCROW_CONFIGURATION_INVALID",
  unexpected: "PREFLIGHT_UNEXPECTED_ERROR",
};

export type ArcPreflightDiagnostic = {
  code: ArcPreflightDiagnosticCode;
  stage: ArcPreflightStage;
};

export function classifyArcPreflightFailure(
  error: unknown,
  fallbackStage: ArcPreflightStage,
): ArcPreflightDiagnostic {
  if (error instanceof ArcPreflightError) {
    return { code: error.code, stage: error.stage };
  }
  return { code: STAGE_CODE[fallbackStage], stage: fallbackStage };
}

export function logArcPreflightFailure(
  error: unknown,
  stage: ArcPreflightStage,
  logger: (diagnostic: ArcPreflightDiagnostic) => void = (diagnostic) => console.error(diagnostic),
): ArcPreflightDiagnostic {
  const diagnostic = classifyArcPreflightFailure(error, stage);
  logger(diagnostic);
  return diagnostic;
}

export function createArcPreflightErrorResponse(): Response {
  return Response.json(
    { error: ARC_PREFLIGHT_PUBLIC_ERROR },
    { status: 503 },
  );
}
