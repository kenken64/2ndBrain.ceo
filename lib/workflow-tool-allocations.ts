export const WORKFLOW_TOOL_PRICE_TOKENS = 10_000;
export const PSLE_ENGLISH_TUTOR_PRICE_TOKENS = 20_000;

export type WorkflowToolAllocation = {
  allocatedTokens: number;
  availableTokens: number;
  quotaExempt: boolean;
  usedTokens: number;
};

export type WorkflowToolInstall = {
  allocation: WorkflowToolAllocation | null;
  chargedTokens: number;
  installedAt: string | null;
  itemId: string;
  itemType: string;
  priceTokens: number;
  status: string;
};

export function normalizeTokenAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.trunc(amount));
}

export function availableWorkflowToolTokens(input: {
  allocatedTokens: unknown;
  quotaExempt?: boolean | null;
  usedTokens: unknown;
}) {
  if (input.quotaExempt) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    normalizeTokenAmount(input.allocatedTokens) - normalizeTokenAmount(input.usedTokens)
  );
}
