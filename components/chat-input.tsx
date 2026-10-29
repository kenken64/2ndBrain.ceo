"use client";

import { LocalizedMessage, useLanguage } from "@/components/language-provider";

import { uiMessagesZh, translateUiMessage } from "@/lib/ui-messages";
import { navigateToPage } from "@/lib/page-navigation";

import { ChangeEvent, FormEvent, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ChevronDown, FileText, Mic, Plus, X } from "lucide-react";

type ChatInputProps = {
  placeholder: string;
  action?: string;
  className?: string;
  defaultPrompt?: string;
  method?: "get" | "post";
  pendingCopy?: string;
  pendingTitle?: string;
  returnTo?: string;
  locale?: "en" | "zh";
};

const ATTACHMENT_ACCEPT = [
  "image/*",
  "application/pdf",
  "text/plain",
  "text/markdown",
  ".md",
  ".markdown",
  ".pdf",
  ".txt",
  ".docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
].join(",");
const MAX_CLIENT_ATTACHMENTS = 8;
const MAX_CLIENT_ATTACHMENT_BYTES = 12 * 1024 * 1024;

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  abort: () => void;
  start: () => void;
  stop: () => void;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function ChatInput({
  action = "/api/projects",
  placeholder,
  className,
  defaultPrompt,
  method = "post",
  pendingCopy,
  pendingTitle,
  returnTo = "/dashboard",
  locale
}: ChatInputProps) {
  const language = useLanguage().language;
  const chinese = (locale ?? language) === "zh";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [promptValue, setPromptValue] = useState(defaultPrompt ?? "");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [submitError, setSubmitError] = useState("");
  const errorId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supportsAttachments = method === "post";
  const shouldHandleSubmit = method === "post" && Boolean(pendingTitle);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  function appendTranscript(transcript: string) {
    setPromptValue((current) => {
      const cleaned = transcript.trim();

      if (!cleaned) {
        return current;
      }

      return current.trim() ? `${current.trimEnd()} ${cleaned}` : cleaned;
    });
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function handleAttachClick() {
    fileInputRef.current?.click();
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    const nextFiles = [...selectedFiles, ...files];

    if (nextFiles.length > MAX_CLIENT_ATTACHMENTS) {
      setSubmitError(`Attach up to ${MAX_CLIENT_ATTACHMENTS} files.`);
      event.target.value = "";
      return;
    }

    const oversized = nextFiles.find((file) => file.size > MAX_CLIENT_ATTACHMENT_BYTES);

    if (oversized) {
      setSubmitError(`${oversized.name} is too large. Maximum file size is 12 MB.`);
      event.target.value = "";
      return;
    }

    setSelectedFiles(nextFiles);
    setSubmitError("");
    event.target.value = "";
  }

  function removeSelectedFile(index: number) {
    setSelectedFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function toggleSpeechToText() {
    if (isSubmitting) {
      return;
    }

    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      setSubmitError("Speech-to-text is not supported in this browser. Try Chrome or Edge on HTTPS/localhost.");
      return;
    }

    const recognition = new Recognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = chinese ? "zh-CN" : navigator.language || "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");

      appendTranscript(transcript);
      setSubmitError("");
    };
    recognition.onerror = (event) => {
      setSubmitError(
        event.error === "not-allowed"
          ? "Microphone permission was denied. Allow microphone access to use speech-to-text."
          : "Speech-to-text failed. Try again or type the prompt manually."
      );
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setSubmitError("");
    setIsListening(true);
    recognition.start();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (isSubmitting) {
      event.preventDefault();
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);

    formData.delete("attachments");
    for (const file of selectedFiles) {
      formData.append("attachments", file, file.name);
    }

    const prompt = String(formData.get("prompt") ?? "").trim();

    if (!prompt) {
      event.preventDefault();
      setSubmitError("Enter a prompt to continue.");
      return;
    }

    setSubmitError("");

    if (!shouldHandleSubmit) {
      if (method === "get") {
        event.preventDefault();
        const url = new URL(action, window.location.origin);
        url.searchParams.set("prompt", prompt);
        navigateToPage(`${url.pathname}${url.search}`);
      }

      return;
    }

    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch(action, {
        body: formData,
        credentials: "same-origin",
        method: "POST"
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Request failed");
      }

      navigateToPage(response.url || returnTo);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Request failed");
      setIsSubmitting(false);
    }
  }

  const isProgressVisible = isSubmitting && Boolean(pendingTitle);

  return (
    <form
      action={action}
      aria-busy={isProgressVisible}
      className={`chat-input ${className ?? ""}`}
      method={method}
      noValidate
      onSubmit={handleSubmit}
    >
      <textarea
        aria-describedby={submitError ? errorId : undefined}
        aria-invalid={Boolean(submitError)}
        aria-label={chinese ? "项目需求" : "Project prompt"}
        className="chat-input__textarea"
        disabled={isSubmitting}
        name="prompt"
        onChange={(event) => setPromptValue(event.target.value)}
        placeholder={chinese ? (uiMessagesZh[placeholder] ?? placeholder) : placeholder}
        rows={3}
        value={promptValue}
      />
      {supportsAttachments ? (
        <input
          ref={fileInputRef}
          accept={ATTACHMENT_ACCEPT}
          className="chat-input__file"
          disabled={isSubmitting}
          multiple
          onChange={handleFilesSelected}
          type="file"
        />
      ) : null}
      {selectedFiles.length > 0 ? (
        <div className="chat-input__attachments" aria-label={chinese ? "已选附件" : "Selected attachments"}>
          {selectedFiles.map((file, index) => (
            <span className="chat-input__attachment" key={`${file.name}-${file.size}-${index}`}>
              <FileText size={14} strokeWidth={1.8} />
              <span>{file.name}</span>
              <small>{formatFileSize(file.size)}</small>
              <button
                aria-label={chinese ? `移除 ${file.name}` : `Remove ${file.name}`}
                disabled={isProgressVisible}
                onClick={() => removeSelectedFile(index)}
                type="button"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {method === "post" ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
      {submitError ? (
        <p className="form-error" id={errorId}>
          {translateUiMessage(submitError, chinese ? "zh" : "en")}
        </p>
      ) : null}
      {isProgressVisible ? (
        <div
          aria-live="polite"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={68}
          className="submit-progress chat-input__progress"
          role="progressbar"
        >
          <div className="submit-progress__meta">
            <strong>{pendingTitle ? <LocalizedMessage text={pendingTitle} /> : null}</strong>
            <span><LocalizedMessage text={pendingCopy ?? "Working on the request."} /></span>
          </div>
          <div className="submit-progress__track">
            <span className="submit-progress__bar" />
          </div>
        </div>
      ) : null}
      <div className="chat-input__bar">
        <div className="chat-input__group">
          {supportsAttachments ? (
            <button
              aria-label={chinese ? "添加图片、PDF、文本、Markdown 或 DOCX 文件" : "Attach image, PDF, text, markdown, or DOCX file"}
              className="btn-icon"
              disabled={isProgressVisible}
              onClick={handleAttachClick}
              type="button"
            >
              <Plus size={18} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <div className="chat-input__group">
          <button className="btn-ghost" disabled={isProgressVisible} type="button">
            {chinese ? "创建" : "Build"}
            <ChevronDown size={14} strokeWidth={1.8} />
          </button>
          <button
            aria-label={isListening ? (chinese ? "停止语音输入" : "Stop voice input") : (chinese ? "语音输入" : "Voice input")}
            aria-pressed={isListening}
            className={`btn-icon${isListening ? " is-listening" : ""}`}
            disabled={isProgressVisible}
            onClick={toggleSpeechToText}
            type="button"
          >
            <Mic size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label={isProgressVisible ? (chinese ? "正在创建知识库" : "Generating Nth Brain") : (chinese ? "发送需求" : "Send prompt")}
            className="chat-input__send"
            disabled={isProgressVisible}
            type="submit"
          >
            <ArrowRight size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </form>
  );
}
