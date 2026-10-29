"use client";

import {Localized, useLanguage } from "@/components/language-provider";


import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { tokensPerSecond, wordCount, type ChatResponseMetrics } from "@/lib/chat-response-metrics";

export function ChatResponseTools({ content, metrics }: { content: string; metrics?: ChatResponseMetrics }) {
  const _uiLanguage = useLanguage().language;
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const words = wordCount(content), speed = tokensPerSecond(metrics);
  return <div className="chat-response-tools">
    <div className="chat-response-tools__stats" aria-label={_uiLanguage === "zh" ? "回复统计" : "Response statistics"}>
      <span>{words.toLocaleString()} {words === 1 ? <Localized en={"word"} zh={"词"} /> : <Localized en={"words"} zh={"词"} />}</span>
      <span title={_uiLanguage === "zh" ? "从发送请求到收到回复的时间，包括处理时间" : "Time from sending the request until the response arrived, including processing"}>{metrics ? (_uiLanguage === "zh" ? `响应时间 ${(metrics.elapsedMs / 1000).toFixed(1)} 秒` : `${(metrics.elapsedMs / 1000).toFixed(1)}s response`) : <Localized en={"Response time —"} zh={"响应时间 —"} />}</span>
      <span title={_uiLanguage === "zh" ? "服务商报告的输出 Token 数除以 AI 请求时间，包括服务商延迟" : "Provider-reported output tokens divided by the AI request time, including provider latency"}>{speed === null ? <Localized en={"Tokens/s —"} zh={"Token/秒 —"} /> : (_uiLanguage === "zh" ? `${speed.toFixed(1)} Token/秒` : `${speed.toFixed(1)} tokens/s`)}</span>
      {metrics?.outputTokens !== undefined ? <span title={_uiLanguage === "zh" ? "AI 服务商报告的输出 Token 数" : "Output tokens reported by the AI provider"}>{_uiLanguage === "zh" ? `${metrics.outputTokens.toLocaleString()} 个输出 Token` : `${metrics.outputTokens.toLocaleString()} output tokens`}</span> : null}
    </div>
    <button className="chat-response-tools__copy" type="button" aria-label={_uiLanguage === "zh" ? "复制回复" : "Copy response"} title={_uiLanguage === "zh" ? "复制回复" : "Copy response"} onClick={() => { void (async () => { try { await navigator.clipboard.writeText(content); setCopyStatus("copied"); } catch { setCopyStatus("failed"); } })(); }}>{copyStatus === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>
    <span className="chat-response-tools__status" role="status">{copyStatus === "copied" ? <Localized en={"Copied"} zh={"已复制"} /> : copyStatus === "failed" ? <Localized en={"Copy failed"} zh={"复制失败"} /> : ""}</span>
  </div>;
}
