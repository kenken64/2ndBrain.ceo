import "server-only";

export type OpenRouterKeyUsage =
  | { status: "unconfigured" }
  | { status: "unavailable" }
  | {
      status: "ok";
      label: string | null;
      limitReset: string | null;
      limitUsd: number | null;
      remainingUsd: number | null;
      usedUsd: number;
    };

type KeyResponse = {
  data?: {
    label?: unknown;
    limit?: unknown;
    limit_remaining?: unknown;
    limit_reset?: unknown;
    usage?: unknown;
  };
};

function usdValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads the spending cap and usage of the server's OPENROUTER_API_KEY, which
 * funds workspace chat. A null limit means OpenRouter enforces no per-key cap.
 */
export async function getOpenRouterKeyUsage(): Promise<OpenRouterKeyUsage> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    return { status: "unconfigured" };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000)
    });

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const { data } = (await response.json()) as KeyResponse;
    const usedUsd = usdValue(data?.usage);

    if (!data || usedUsd === null) {
      return { status: "unavailable" };
    }

    return {
      label: typeof data.label === "string" ? data.label : null,
      limitReset: typeof data.limit_reset === "string" ? data.limit_reset : null,
      limitUsd: usdValue(data.limit),
      remainingUsd: usdValue(data.limit_remaining),
      status: "ok",
      usedUsd
    };
  } catch {
    return { status: "unavailable" };
  }
}
