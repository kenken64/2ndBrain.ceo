"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { tokensPerSecond, wordCount, type ChatResponseMetrics } from "@/lib/chat-response-metrics";

export function ChatResponseTools({ content, metrics }: { content: string; metrics?: ChatResponseMetrics }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const words = wordCount(content), speed = tokensPerSecond(metrics);
  return <div className="chat-response-tools">
    <div className="chat-response-tools__stats" aria-label="Response statistics">
      <span>{words.toLocaleString()} {words === 1 ? "word" : "words"}</span>
      <span title="Time from sending the request until the response arrived, including processing">{metrics ? `${(metrics.elapsedMs / 1000).toFixed(1)}s response` : "Response time —"}</span>
      <span title="Provider-reported output tokens divided by the AI request time, including provider latency">{speed === null ? "Tokens/s —" : `${speed.toFixed(1)} tokens/s`}</span>
      {metrics?.outputTokens !== undefined ? <span title="Output tokens reported by the AI provider">{metrics.outputTokens.toLocaleString()} output tokens</span> : null}
    </div>
    <button className="chat-response-tools__copy" type="button" aria-label="Copy response" title="Copy response" onClick={() => { void (async () => { try { await navigator.clipboard.writeText(content); setCopyStatus("copied"); } catch { setCopyStatus("failed"); } })(); }}>{copyStatus === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>
    <span className="chat-response-tools__status" role="status">{copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : ""}</span>
  </div>;
}
