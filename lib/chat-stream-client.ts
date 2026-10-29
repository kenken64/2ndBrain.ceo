type Completion = { message: string; model?: unknown; usagePending?: boolean; quotaExempt?: boolean; truncated?: boolean; chargedCredits?: unknown; availableCredits?: unknown; generationMs?: unknown; outputTokens?: unknown };

export async function readChatStream(response: Response, onDelta: (text: string) => void): Promise<Completion> {
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "Could not start the chat response.");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/x-ndjson")) throw new Error("The chat response was not streamed. Check AI Credits Usage before retrying.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", message = "", result: Completion | null = null;
  const parse = (line: string) => {
    if (!line) return;
    const event = JSON.parse(line) as { type?: string; text?: unknown; message?: unknown; model?: unknown; usagePending?: boolean; quotaExempt?: boolean; truncated?: boolean; chargedCredits?: unknown; availableCredits?: unknown; generationMs?: unknown; outputTokens?: unknown };
    if (event.type === "delta" && typeof event.text === "string") { message += event.text; if (message.length > 30_000) throw new Error("The response exceeded the chat length limit."); onDelta(message); }
    else if (event.type === "error") throw new Error(typeof event.message === "string" ? event.message : "The response was interrupted. Check AI Credits Usage before retrying.");
    else if (event.type === "done") result = { message, model: event.model, generationMs: event.generationMs, outputTokens: event.outputTokens, usagePending: event.usagePending, quotaExempt: event.quotaExempt, truncated: event.truncated, chargedCredits: event.chargedCredits, availableCredits: event.availableCredits };
  };
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length > 256_000) throw new Error("The response stream was too large.");
      const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; lines.forEach(parse);
    }
    buffer += decoder.decode(); if (buffer.trim()) parse(buffer);
    if (!result) throw new Error("The response ended before completion. Check AI Credits Usage before retrying.");
    return result;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
