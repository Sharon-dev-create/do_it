export type X402IntentStatus =
  | "verified"
  | "settlement_submitted"
  | "recovery_pending"
  | "provider_accepted"
  | "response_ready"
  | "operator_review"
  | "rejected";

export type X402Intent = {
  id: string;
  status: X402IntentStatus;
  response_status: number | null;
  response_body: unknown | null;
  provider_transfer_id: string | null;
  provider_status: string | null;
};

export type X402SettlementResult = {
  success: boolean;
  network: string;
  transaction: string;
  payer?: string;
  errorReason?: string;
};

export type X402HttpResponse = {
  status: number;
  body: unknown;
  paymentResponse: string;
};

type FlowResult =
  | { kind: "response"; response: X402HttpResponse }
  | { kind: "pending"; status: X402IntentStatus };

type X402FlowDependencies = {
  prepare: () => Promise<X402Intent>;
  claim: (intentId: string) => Promise<{ claimed: boolean; status: X402IntentStatus }>;
  settle: () => Promise<X402SettlementResult>;
  markRecoveryPending: (intentId: string, errorCode: string) => Promise<void>;
  recordProviderAcceptance: (
    intentId: string,
    transferId: string,
  ) => Promise<void>;
  buildResponse: () => Promise<{ status: number; body: unknown }>;
  saveResponse: (
    intentId: string,
    status: number,
    body: unknown,
  ) => Promise<{ status: number; body: unknown }>;
  expectedNetwork: string;
  expectedPayer: string;
  createPaymentResponse: (transferId: string) => string;
  onRecoveryStateWriteFailure: (intentId: string, errorCode: string) => void;
};

async function markRecoveryPending(
  dependencies: X402FlowDependencies,
  intentId: string,
  errorCode: string,
): Promise<void> {
  try {
    await dependencies.markRecoveryPending(intentId, errorCode);
  } catch {
    dependencies.onRecoveryStateWriteFailure(intentId, errorCode);
    throw new Error("Unable to persist the x402 recovery state.");
  }
}

function storedResponse(intent: X402Intent, paymentResponse: string): FlowResult {
  if (intent.response_status === null || intent.response_body === null) {
    return { kind: "pending", status: "operator_review" };
  }
  return {
    kind: "response",
    response: {
      status: intent.response_status,
      body: intent.response_body,
      paymentResponse,
    },
  };
}

export async function executeX402PaymentFlow(
  dependencies: X402FlowDependencies,
): Promise<FlowResult> {
  const intent = await dependencies.prepare();
  if (intent.status === "response_ready") {
    if (!intent.provider_transfer_id) {
      return { kind: "pending", status: "operator_review" };
    }
    return storedResponse(
      intent,
      dependencies.createPaymentResponse(intent.provider_transfer_id),
    );
  }

  if (
    intent.status === "settlement_submitted" ||
    intent.status === "recovery_pending" ||
    intent.status === "operator_review" ||
    intent.status === "rejected"
  ) {
    return { kind: "pending", status: intent.status };
  }

  let transferId = intent.provider_transfer_id;
  if (intent.status === "verified") {
    const claim = await dependencies.claim(intent.id);
    if (!claim.claimed) {
      return { kind: "pending", status: claim.status };
    }

    let settlement: X402SettlementResult;
    try {
      settlement = await dependencies.settle();
    } catch {
      await markRecoveryPending(
        dependencies,
        intent.id,
        "settlement_outcome_unknown",
      );
      return { kind: "pending", status: "recovery_pending" };
    }

    if (
      !settlement.success ||
      settlement.network !== dependencies.expectedNetwork ||
      typeof settlement.transaction !== "string" ||
      settlement.transaction.length === 0 ||
      !settlement.payer ||
      settlement.payer.toLowerCase() !== dependencies.expectedPayer.toLowerCase()
    ) {
      await markRecoveryPending(
        dependencies,
        intent.id,
        "settlement_result_unverified",
      );
      return { kind: "pending", status: "recovery_pending" };
    }

    transferId = settlement.transaction;
    try {
      await dependencies.recordProviderAcceptance(intent.id, transferId);
    } catch {
      await markRecoveryPending(
        dependencies,
        intent.id,
        "provider_acceptance_persistence_failed",
      );
      return { kind: "pending", status: "recovery_pending" };
    }
  }

  if (intent.status !== "verified" && intent.status !== "provider_accepted") {
    return { kind: "pending", status: intent.status };
  }
  if (!transferId) {
    return { kind: "pending", status: "operator_review" };
  }

  let generated: { status: number; body: unknown };
  try {
    generated = await dependencies.buildResponse();
  } catch {
    return { kind: "pending", status: "provider_accepted" };
  }

  try {
    const saved = await dependencies.saveResponse(
      intent.id,
      generated.status,
      generated.body,
    );
    return {
      kind: "response",
      response: {
        status: saved.status,
        body: saved.body,
        paymentResponse: dependencies.createPaymentResponse(transferId),
      },
    };
  } catch {
    return { kind: "pending", status: "provider_accepted" };
  }
}
