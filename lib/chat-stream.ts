export type StreamUsage = { cost?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown };
type CreditRow = { llm_token_quota: number | string; llm_token_used: number | string; charged_credits?: number | string };
type StreamOptions = {
  upstream: Response;
  requestSignal: AbortSignal;
  upstreamAbort: AbortController;
  model: string;
  startedAt: number;
  quotaExempt: boolean;
  settle: (status: "completed" | "uncertain", cost: number | null, providerId: string | null, usage?: StreamUsage) => Promise<CreditRow | null>;
  lookupCost: (providerId: string) => Promise<number | null>;
};
const MAX_OUTPUT_CHARS = 30_000;
const MAX_EVENT_CHARS = 256_000;

// Convert provider SSE into a small, private NDJSON stream while settling each reservation exactly once.
export function streamChatResponse(options: StreamOptions): Response {
  const reader = options.upstream.body!.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
  let disconnected = false, providerFinished = false, providerId: string | null = options.upstream.headers.get("x-generation-id");
  let usage: StreamUsage | undefined, textLength = 0, finishReason: string | null = null;
  let settlement: Promise<CreditRow | null> | null = null;
  const settleOnce = (status: "completed" | "uncertain", cost: number | null) => {
    if (!settlement) settlement = options.settle(status, cost, providerId, usage).catch(() => null);
    return settlement;
  };
  const disconnect = () => {
    disconnected = true;
    if (!providerFinished) {
      options.upstreamAbort.abort();
      void reader.cancel().catch(() => undefined);
      void settleOnce("uncertain", null);
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (data: unknown) => { if (!disconnected) controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`)); };
      options.requestSignal.addEventListener("abort", disconnect, { once: true });
      if (options.requestSignal.aborted) disconnect();
      let buffer = "", dataLines: string[] = [], sawDone = false;
      const event = () => {
        if (!dataLines.length) return;
        const data = dataLines.join("\n"); dataLines = [];
        if (data === "[DONE]") { sawDone = true; return; }
        let chunk: { id?: unknown; error?: unknown; usage?: StreamUsage; choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> };
        try { chunk = JSON.parse(data); } catch { throw new Error("The AI response stream was invalid."); }
        if (chunk.error) throw new Error("The AI provider interrupted the response.");
        if (typeof chunk.id === "string" && chunk.id.length <= 200) providerId = chunk.id;
        if (chunk.usage && typeof chunk.usage === "object") usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
        if (typeof choice?.delta?.content === "string" && choice.delta.content) {
          const remaining = MAX_OUTPUT_CHARS - textLength;
          const delta = choice.delta.content.slice(0, remaining);
          if (delta) { textLength += delta.length; emit({ type: "delta", text: delta }); }
          if (delta.length !== choice.delta.content.length) throw new Error("The response exceeded the chat length limit.");
        }
      };
      const lines = (flush = false) => {
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
          if (!line) event(); else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
          if (dataLines.reduce((sum, item) => sum + item.length, 0) > MAX_EVENT_CHARS) throw new Error("The AI response stream was too large.");
        }
        if (flush && buffer) { const line = buffer.replace(/\r$/, ""); buffer = ""; if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, "")); }
        if (flush) event();
        if (buffer.length > MAX_EVENT_CHARS) throw new Error("The AI response stream was too large.");
      };
      try {
        while (!disconnected && !sawDone) {
          const part = await reader.read(); if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true }); lines();
        }
        if (disconnected) return;
        buffer += decoder.decode(); lines(true);
        if (!sawDone) throw new Error("The AI response ended before completion.");
        providerFinished = true;
        const generationMs = Math.max(0, performance.now() - options.startedAt);
        let cost = typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
        if (cost === null && providerId) cost = await options.lookupCost(providerId).catch(() => null);
        const billed = await settleOnce(cost === null ? "uncertain" : "completed", cost);
        if (!textLength) {
          emit({ type: "error", message: billed && cost !== null ? `The model returned an empty response. ${Number(billed.charged_credits ?? 0).toLocaleString("en")} AI credits were used.` : "The model returned an empty response. Usage is unconfirmed; check AI Credits Usage." });
        } else {
          emit({ type: "done", model: options.model, generationMs, ...(typeof usage?.completion_tokens === "number" && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0 ? { outputTokens: usage.completion_tokens } : {}), usagePending: cost === null || !billed, quotaExempt: options.quotaExempt, truncated: finishReason === "length", ...(billed && cost !== null ? { chargedCredits: Number(billed.charged_credits ?? 0), availableCredits: Math.max(0, Number(billed.llm_token_quota) - Number(billed.llm_token_used)) } : {}) });
        }
      } catch (error) {
        options.upstreamAbort.abort();
        await settleOnce("uncertain", null);
        emit({ type: "error", message: `${error instanceof Error ? error.message : "The AI response was interrupted."} Usage is unconfirmed; check AI Credits Usage before retrying.` });
      } finally {
        options.requestSignal.removeEventListener("abort", disconnect);
        if (!providerFinished) void reader.cancel().catch(() => undefined);
        try { reader.releaseLock(); } catch { /* a canceled read may still be settling */ }
        if (!disconnected) controller.close();
      }
    },
    async cancel() { disconnect(); await settlement; }
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
}
