export const CHAT_MODELS = [
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
  { id: "moonshotai/kimi-k3.1-pro", label: "Kimi K3.1 Pro" },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "z-ai/glm-5.3", label: "GLM 5.3" }
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];
export type ChatMessage = { role: "user" | "assistant"; content: string };
export const CHAT_MAX_MESSAGES = 20;
export const CHAT_MAX_MESSAGE_CHARS = 8_000;
export const CHAT_MAX_TOTAL_BYTES = 40_000;
export const CHAT_MAX_OUTPUT_TOKENS = 1_200;

export function isChatModel(value: unknown): value is ChatModelId {
  return typeof value === "string" && CHAT_MODELS.some((model) => model.id === value);
}

export function validateChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > CHAT_MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  let bytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" || !item.content.trim() || item.content.length > CHAT_MAX_MESSAGE_CHARS) return null;
    bytes += new TextEncoder().encode(item.content).length;
    messages.push({ role: item.role, content: item.content.trim() });
  }
  if (bytes > CHAT_MAX_TOTAL_BYTES || messages[messages.length - 1].role !== "user") return null;
  return messages;
}
