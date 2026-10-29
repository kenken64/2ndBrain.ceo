export type ChatResponseMetrics = { elapsedMs: number; outputTokens?: number; generationMs?: number };

export function isChatResponseMetrics(value: unknown): value is ChatResponseMetrics {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0 &&
    (item.generationMs === undefined || (typeof item.generationMs === "number" && Number.isFinite(item.generationMs) && item.generationMs >= 0)) &&
    (item.outputTokens === undefined || (typeof item.outputTokens === "number" && Number.isSafeInteger(item.outputTokens) && item.outputTokens >= 0));
}

export function wordCount(text: string): number {
  if (typeof Intl.Segmenter === "function") return Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)).filter(segment => segment.isWordLike).length;
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

export function tokensPerSecond(metrics?: ChatResponseMetrics): number | null {
  if (!metrics || metrics.outputTokens === undefined || metrics.generationMs === undefined || metrics.generationMs <= 0) return null;
  return metrics.outputTokens * 1000 / metrics.generationMs;
}
