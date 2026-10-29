"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


import { FormEvent, useEffect, useId, useState } from "react";
import {
  Bot,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type OpenClawInstance = {
  agentType: "openclaw" | "hermes_agent";
  consumerName: string;
  createdAt: string | null;
  error: string | null;
  id: string;
  instance: string | null;
  label: string | null;
  region: string | null;
  status: string;
  updatedAt: string | null;
};

type InstancesResponse = {
  instances: OpenClawInstance[];
  maxInstances: number;
};

const ERROR_COPY: Record<string, string> = {
  instance_not_found: "The AI Agent instance could not be found.",
  instance_not_ready: "The instance is not ready for Telegram pairing yet.",
  insufficient_ai_credits: "Not enough AI credits to provision a new AI Agent instance.",
  instance_limit_reached: "You have reached the maximum number of AI Agent instances.",
  invalid_telegram_bot_token: "Enter a valid Telegram bot token.",
  invalid_telegram_pair_code: "Enter the 8-character approval code from Telegram.",
  missing_fields: "Finish onboarding (avatar and Telegram bot) before provisioning an instance.",
  missing_hermes_lightsail_snapshot_name: "The Hermes provisioning template is not configured.",
  missing_hermes_gyne_redis_url: "The Gyne connection is not configured on the server.",
  openclaw_deprovision_failed: "The instance could not be fully removed. Try again.",
  openclaw_provision_failed: "Provisioning failed. Please try again.",
  openclaw_telegram_pair_failed: "Telegram approval failed. Check the code from Telegram and try again.",
  provision_running: "Another instance is still provisioning. Wait for it to finish."
};

function friendlyError(code: string | undefined, fallback: string) {
  if (code && ERROR_COPY[code]) {
    return ERROR_COPY[code];
  }

  return code || fallback;
}

function validateTelegramBotToken(value: string) {
  if (!value) {
    return "Telegram bot token is required.";
  }

  if (value.length > 256) {
    return "Telegram bot token is too long.";
  }

  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(value)) {
    return "Enter a valid Telegram bot token.";
  }

  return "";
}

function formatDate(value: string | null, zh = false) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function statusClass(status: string) {
  if (status === "ready") {
    return "project-status project-status--ready";
  }

  if (status === "failed") {
    return "project-status project-status--failed";
  }

  return "project-status";
}

export function OpenClawInstancesPanel() {
  const _uiLanguage = useLanguage().language;
  const [instances, setInstances] = useState<OpenClawInstance[]>([]);
  const [maxInstances, setMaxInstances] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [reprovisioningId, setReprovisioningId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null);
  const [isProvisionDialogOpen, setIsProvisionDialogOpen] = useState(false);
  const [agentType, setAgentType] = useState<"openclaw" | "hermes_agent">("openclaw");
  const [isTokenVisible, setIsTokenVisible] = useState(false);
  const [provisionDialogError, setProvisionDialogError] = useState("");
  const [pairTarget, setPairTarget] = useState<{ id: string; name: string } | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairDialogError, setPairDialogError] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tokenErrorId = useId();
  const pairCodeErrorId = useId();

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/openclaw/instances", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | (InstancesResponse & { error?: string })
        | null;

      if (!response.ok || !payload) {
        throw new Error(friendlyError(payload?.error, "AI Agent instances could not be loaded."));
      }

      setInstances(payload.instances);
      setMaxInstances(payload.maxInstances);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "AI Agent instances could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  // Reconcile stored rows against Lightsail so instances whose host was deleted show as "failed" (with a
  // Re-provision prompt) instead of silently timing out on the next SSH call.
  async function reconcile() {
    setReconciling(true);

    try {
      const response = await fetch("/api/openclaw/instances/reconcile", {
        cache: "no-store",
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as
        | (InstancesResponse & { error?: string })
        | null;

      if (response.ok && payload) {
        setInstances(payload.instances);
        setMaxInstances(payload.maxInstances);
      }
    } catch {
      // Best-effort: keep the last loaded list if the health check fails.
    } finally {
      setReconciling(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await refresh();
      await reconcile();
    })();
  }, []);

  function closeProvisionDialog() {
    if (provisioning) {
      return;
    }

    setIsProvisionDialogOpen(false);
    setIsTokenVisible(false);
    setProvisionDialogError("");
  }

  function closePairDialog() {
    if (pairing) {
      return;
    }

    setPairTarget(null);
    setPairDialogError("");
  }

  async function handleProvisionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (provisioning) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const token = String(formData.get("telegramBotToken") ?? "").trim();
    const validationError = validateTelegramBotToken(token);

    if (validationError) {
      setProvisionDialogError(validationError);
      return;
    }

    setProvisioning(true);
    setProvisionDialogError("");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/openclaw/instances", {
        body: JSON.stringify({ agentType, telegramBotToken: token }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; instance?: OpenClawInstance }
        | null;

      if (!response.ok) {
        throw new Error(friendlyError(payload?.error, "The AI Agent instance could not be provisioned."));
      }

      setIsProvisionDialogOpen(false);
      setIsTokenVisible(false);
      setMessage(
        "AI Agent instance provisioned. Send your Telegram bot a message like “hi” — it replies with the 8-character approval code. Approve it to finish pairing."
      );
      await refresh();

      // Same flow as onboarding: provisioning hands straight off to the Telegram approval step.
      if (payload?.instance) {
        setPairTarget({
          id: payload.instance.id,
          name: payload.instance.label || payload.instance.consumerName
        });
      }
    } catch (provisionError) {
      setProvisionDialogError(
        provisionError instanceof Error ? provisionError.message : "The AI Agent instance could not be provisioned."
      );
    } finally {
      setProvisioning(false);
    }
  }

  async function handlePairSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pairing || !pairTarget) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("telegramPairCode") ?? "").trim();

    if (!/^[A-Za-z0-9]{8}$/.test(code)) {
      setPairDialogError("Enter the 8-character approval code from Telegram.");
      return;
    }

    setPairing(true);
    setPairDialogError("");
    setMessage(null);

    try {
      const response = await fetch(`/api/openclaw/instances/${pairTarget.id}/telegram-pair`, {
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(friendlyError(payload?.error, "Telegram approval failed. Check the code from Telegram and try again."));
      }

      setMessage(`Telegram paired on ${pairTarget.name}.`);
      setPairTarget(null);
    } catch (pairError) {
      setPairDialogError(
        pairError instanceof Error ? pairError.message : "Telegram approval failed. Check the code from Telegram and try again."
      );
    } finally {
      setPairing(false);
    }
  }

  async function removeInstance(id: string) {
    setRemovingId(id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/openclaw/instances/${id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(friendlyError(payload?.error, "The AI Agent instance could not be removed."));
      }

      setInstances((current) => current.filter((instance) => instance.id !== id));
      setMessage("AI Agent instance removed.");
      setPendingRemoval(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The AI Agent instance could not be removed.");
    } finally {
      setRemovingId(null);
    }
  }

  async function reprovisionInstance(id: string) {
    if (reprovisioningId) {
      return;
    }

    setReprovisioningId(id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/openclaw/instances/${id}/reprovision`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; instance?: OpenClawInstance; restored?: boolean }
        | null;

      if (!response.ok) {
        throw new Error(friendlyError(payload?.error, "The AI Agent instance could not be re-provisioned."));
      }

      await refresh();

      if (payload?.restored) {
        // A fresh snapshot restore resets Telegram pairing, so hand off to the approval step.
        setMessage(
          "AI Agent instance restored from the snapshot. Send your Telegram bot a message like “hi” — it replies with the 8-character approval code. Approve it to finish pairing."
        );

        if (payload.instance) {
          setPairTarget({
            id: payload.instance.id,
            name: payload.instance.label || payload.instance.consumerName
          });
        }
      } else {
        setMessage("AI Agent instance reconnected. The Lightsail host was healthy, so no restore was needed.");
      }
    } catch (reprovisionError) {
      setError(
        reprovisionError instanceof Error
          ? reprovisionError.message
          : "The AI Agent instance could not be re-provisioned."
      );
    } finally {
      setReprovisioningId(null);
    }
  }

  const activeCount = instances.filter((instance) => instance.status !== "failed" && instance.status !== "stopped").length;
  const atLimit = maxInstances > 0 && activeCount >= maxInstances;
  const provisionDisabled = provisioning || atLimit || reprovisioningId !== null;

  return (
    <section className="workflow-marketplace-stack">
      <div className="workflow-marketplace-summary">
        <div>
          <p className="workspace-status-card__eyebrow"><Localized en={"AI Agent instances"} zh={"AI Agent 实例"} /></p>
          <h2>
            {loading
              ? <Localized en={"Loading AI Agent instances"} zh={"正在加载 AI Agent 实例"} />
              : maxInstances > 0
                ? (_uiLanguage === "zh" ? `已使用 ${activeCount} / ${maxInstances}` : `${activeCount} of ${maxInstances} in use`)
                : (_uiLanguage === "zh" ? `已使用 ${activeCount}` : `${activeCount} in use`)}
          </h2>
          <p><Localized en={"Each instance is a private AI Agent worker that only you can see and use in the Gyne Agent."} zh={"每个实例都是私有 AI Agent 工作进程，只有您可以在 Gyne Agent 中查看和使用。"} /></p>
        </div>
        <div className="workflow-card__actions">
          <button
            className="btn-ghost"
            disabled={loading || provisioning || reprovisioningId !== null}
            onClick={refresh}
            type="button"
          >
            <RefreshCw size={16} strokeWidth={1.8} />
            <Localized en={"Refresh"} zh={"刷新"} /></button>
          <button
            className="btn-primary"
            disabled={provisionDisabled}
            onClick={() => setIsProvisionDialogOpen(true)}
            type="button"
          >
            {provisioning ? <RefreshCw size={16} strokeWidth={1.8} /> : <Plus size={16} strokeWidth={1.8} />}
            {provisioning ? <Localized en={"Provisioning..."} zh={"正在配置..."} /> : <Localized en={"Provision instance"} zh={"配置实例"} />}
          </button>
        </div>
      </div>

      {atLimit ? (
        <p className="workflow-card__hint">
          <Localized en={"You have reached your AI Agent instance limit. Remove an instance to provision another."} zh={"已达到 AI Agent 实例上限。请移除一个实例后再配置新实例。"} /></p>
      ) : null}
      {provisioning ? (
        <p className="workflow-card__hint"><Localized en={"Provisioning a new instance can take a few minutes. Keep this tab open."} zh={"配置新实例可能需要几分钟。请保持此标签页打开。"} /></p>
      ) : null}
      {reprovisioningId ? (
        <p className="workflow-card__hint">
          <Localized en={"Re-provisioning restores the instance from the snapshot. This can take a few minutes. Keep this tab open."} zh={"重新配置会从快照恢复实例，可能需要几分钟。请保持此标签页打开。"} /></p>
      ) : null}
      {reconciling && !loading ? <p className="workflow-card__hint"><Localized en={"Checking instance health…"} zh={"正在检查实例运行状态…"} /></p> : null}
      {error ? <p className="form-error" role="alert"><LocalizedMessage text={error} /></p> : null}
      {message ? <p className="form-success" role="status"><LocalizedMessage text={message} /></p> : null}

      {!loading && instances.length === 0 ? (
        <article className="workflow-empty">
          <div>
            <p className="workspace-status-card__eyebrow"><Localized en={"No instances yet"} zh={"暂无实例"} /></p>
            <h2><Localized en={"Provision your first AI Agent instance"} zh={"配置您的第一个 AI Agent 实例"} /></h2>
            <p><Localized en={"Provisioned instances appear in the Gyne Agent so you can route tasks to them."} zh={"配置完成的实例会显示在 Gyne Agent 中，以便您向其分配任务。"} /></p>
          </div>
        </article>
      ) : null}

      {instances.length > 0 ? (
        <div className="workflow-grid">
          {instances.map((instance) => {
            const createdDate = formatDate(instance.createdAt, _uiLanguage === "zh");
            const isRemoving = removingId === instance.id;
            const isReprovisioning = reprovisioningId === instance.id;
            const isTransient = instance.status === "provisioning" || instance.status === "deprovisioning";
            const canReprovision = !isTransient;
            const canPair = instance.status === "ready" && Boolean(instance.instance);

            return (
              <article className="workflow-card" key={instance.id}>
                <div className="workflow-card__header">
                  <div>
                    <span className="workspace-status-card__eyebrow">
                      <Cpu size={14} strokeWidth={1.8} /> AI Agent
                    </span>
                    <h2>{instance.label || instance.consumerName}</h2>
                    <p>{instance.agentType === "hermes_agent" ? "Hermes Agent" : "OpenClaw"}</p>
                  </div>
                  <span className={statusClass(instance.status)}><LocalizedMessage text={instance.status} /></span>
                </div>
                <dl className="workflow-card__allocation">
                  <div>
                    <dt><Localized en={"Consumer"} zh={"消费者"} /></dt>
                    <dd>{instance.consumerName}</dd>
                  </div>
                  <div>
                    <dt><Localized en={"Instance"} zh={"实例"} /></dt>
                    <dd>{instance.instance ?? "—"}</dd>
                  </div>
                  <div>
                    <dt><Localized en={"Region"} zh={"区域"} /></dt>
                    <dd>{instance.region ?? "—"}</dd>
                  </div>
                </dl>
                <p className="workflow-card__billing">{createdDate ? (_uiLanguage === "zh" ? `创建日期：${createdDate}。` : `Created: ${createdDate}.`) : ""}</p>
                {instance.status === "failed" && instance.error ? (
                  <p className="workflow-card__hint"><LocalizedMessage text={instance.error} /></p>
                ) : null}
                <div className="workflow-card__actions">
                  {canPair ? (
                    <button
                      className="btn-ghost"
                      disabled={isRemoving || isReprovisioning || pairing}
                      onClick={() =>
                        setPairTarget({ id: instance.id, name: instance.label || instance.consumerName })
                      }
                      type="button"
                    >
                      <KeyRound size={16} strokeWidth={1.8} />
                      <Localized en={"Pair Telegram"} zh={"配对 Telegram"} /></button>
                  ) : null}
                  {canReprovision ? (
                    <button
                      className="btn-ghost"
                      disabled={isRemoving || isReprovisioning || reprovisioningId !== null}
                      onClick={() => reprovisionInstance(instance.id)}
                      title={_uiLanguage === "zh" ? "如果 Lightsail 主机已删除或无响应，请从快照重新创建此实例。" : "Recreate this instance from the snapshot if the Lightsail host was deleted or is unresponsive."}
                      type="button"
                    >
                      {isReprovisioning ? (
                        <LoaderCircle className="spin-icon" size={16} strokeWidth={1.8} />
                      ) : (
                        <RotateCcw size={16} strokeWidth={1.8} />
                      )}
                      {isReprovisioning ? <Localized en={"Re-provisioning..."} zh={"正在重新配置..."} /> : <Localized en={"Re-provision"} zh={"重新配置"} />}
                    </button>
                  ) : null}
                  <button
                    className="btn-ghost danger-button"
                    disabled={isRemoving || isReprovisioning}
                    onClick={() =>
                      setPendingRemoval({ id: instance.id, name: instance.label || instance.consumerName })
                    }
                    type="button"
                  >
                    <Trash2 size={16} strokeWidth={1.8} />
                    {isRemoving ? <Localized en={"Removing..."} zh={"正在移除..."} /> : <Localized en={"Remove"} zh={"移除"} />}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {isProvisionDialogOpen ? (
        <div className="settings-dialog" role="presentation">
          <button
            aria-label={_uiLanguage === "zh" ? "关闭配置实例对话框" : "Close provision instance dialog"}
            className="settings-dialog__scrim"
            disabled={provisioning}
            onClick={closeProvisionDialog}
            type="button"
          />
          <section
            aria-labelledby="provision-instance-dialog-title"
            aria-modal="true"
            className="settings-dialog__panel"
            role="dialog"
          >
            <button
              aria-label={_uiLanguage === "zh" ? "关闭配置实例对话框" : "Close provision instance dialog"}
              className="settings-dialog__close"
              disabled={provisioning}
              onClick={closeProvisionDialog}
              type="button"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
            <div className="settings-dialog__icon" aria-hidden="true">
              <Bot size={28} strokeWidth={1.9} />
            </div>
            <p className="workspace-status-card__eyebrow"><Localized en={"AI Agent instance"} zh={"AI Agent 实例"} /></p>
            <h2 id="provision-instance-dialog-title"><Localized en={"Provision a new instance"} zh={"配置新实例"} /></h2>
            <p>
              <Localized en={"Each instance pairs with its own Telegram bot. Create a bot with BotFather and paste its token here. After provisioning, approve the 8-character pairing code from the bot."} zh={"每个实例都与自己的 Telegram 机器人配对。请使用 BotFather 创建机器人并将其令牌粘贴到这里。配置完成后，请批准机器人提供的 8 位配对码。"} /></p>
            <form className="settings-dialog__form" noValidate onSubmit={handleProvisionSubmit}>
              <label className="field-stack">
                <span><Localized en="Agent" zh="智能体" /></span>
                <select disabled={provisioning} value={agentType} onChange={(event) => setAgentType(event.target.value as "openclaw" | "hermes_agent")}>
                  <option value="openclaw">{"OpenClaw"}</option>
                  <option value="hermes_agent">{"Hermes Agent"}</option>
                </select>
              </label>
              <label className="field-stack">
                <span>
                  <Send size={18} strokeWidth={1.8} />
                  <Localized en="Telegram bot token" zh="Telegram 机器人令牌" />
                </span>
                <div className="secret-input">
                  <input
                    aria-describedby={provisionDialogError ? tokenErrorId : undefined}
                    aria-invalid={Boolean(provisionDialogError)}
                    autoComplete="off"
                    disabled={provisioning}
                    name="telegramBotToken"
                    placeholder="123456789:AA..."
                    type={isTokenVisible ? "text" : "password"}
                  />
                  <button
                    aria-label={_uiLanguage === "zh" ? (isTokenVisible ? "隐藏 Telegram 机器人令牌" : "显示 Telegram 机器人令牌") : (isTokenVisible ? "Hide Telegram bot token" : "Show Telegram bot token")}
                    className="secret-input__toggle"
                    disabled={provisioning}
                    onClick={() => setIsTokenVisible((current) => !current)}
                    type="button"
                  >
                    {isTokenVisible ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
                  </button>
                </div>
              </label>
              {provisionDialogError ? (
                <p className="form-error" id={tokenErrorId}>
                  <LocalizedMessage text={provisionDialogError} />
                </p>
              ) : null}
              {provisioning ? (
                <div
                  aria-live="polite"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={68}
                  className="submit-progress settings-dialog__progress"
                  role="progressbar"
                >
                  <div className="submit-progress__meta">
                    <strong><Localized en={"Provisioning instance"} zh={"正在配置实例"} /></strong>
                    <span><Localized en={"Restoring the snapshot, configuring your Telegram bot, and registering the consumer."} zh={"正在恢复快照、配置 Telegram 机器人并注册消费者。"} /></span>
                  </div>
                  <div className="submit-progress__track">
                    <span className="submit-progress__bar" />
                  </div>
                </div>
              ) : null}
              <div className="settings-dialog__actions">
                <button className="btn-ghost" disabled={provisioning} onClick={closeProvisionDialog} type="button">
                  <Localized en={"Cancel"} zh={"取消"} /></button>
                <button className="btn-primary btn-primary--compact" disabled={provisioning} type="submit">
                  {provisioning ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <Plus size={17} strokeWidth={1.8} />}
                  {provisioning ? <Localized en={"Provisioning..."} zh={"正在配置..."} /> : <Localized en={"Provision instance"} zh={"配置实例"} />}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {pairTarget ? (
        <div className="settings-dialog" role="presentation">
          <button
            aria-label={_uiLanguage === "zh" ? "关闭 Telegram 批准对话框" : "Close Telegram approval dialog"}
            className="settings-dialog__scrim"
            disabled={pairing}
            onClick={closePairDialog}
            type="button"
          />
          <section
            aria-labelledby="pair-telegram-dialog-title"
            aria-modal="true"
            className="settings-dialog__panel"
            role="dialog"
          >
            <button
              aria-label={_uiLanguage === "zh" ? "关闭 Telegram 批准对话框" : "Close Telegram approval dialog"}
              className="settings-dialog__close"
              disabled={pairing}
              onClick={closePairDialog}
              type="button"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
            <div className="settings-dialog__icon" aria-hidden="true">
              <KeyRound size={28} strokeWidth={1.9} />
            </div>
            <p className="workspace-status-card__eyebrow"><Localized en={"Telegram approval"} zh={"Telegram 批准"} /></p>
            <h2 id="pair-telegram-dialog-title"><Localized en={`Approve Telegram on ${pairTarget.name}`} zh={`在 ${pairTarget.name} 上批准 Telegram`} /></h2>
            <p>
              <Localized en="Open your Telegram bot and send it any message, like “hi” (or tap Start) — the bot cannot message you first. It replies with the 8-character approval code; submit it here to pair the bot with this instance." zh="打开 Telegram 机器人并发送任意消息，例如“hi”（或点击开始）；机器人无法主动向您发送消息。机器人会回复 8 位批准码；请在此提交以将机器人与此实例配对。" />
            </p>
            <form className="settings-dialog__form" noValidate onSubmit={handlePairSubmit}>
              <label className="field-stack">
                <span>
                  <KeyRound size={18} strokeWidth={1.8} />
                  <Localized en={"Telegram approval code"} zh={"Telegram 批准码"} /></span>
                <input
                  aria-describedby={pairDialogError ? pairCodeErrorId : undefined}
                  aria-invalid={Boolean(pairDialogError)}
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  disabled={pairing}
                  inputMode="text"
                  maxLength={8}
                  name="telegramPairCode"
                  placeholder={_uiLanguage === "zh" ? "8 位验证码" : "8-character code"}
                  type="text"
                />
              </label>
              {pairDialogError ? (
                <p className="form-error" id={pairCodeErrorId}>
                  <LocalizedMessage text={pairDialogError} />
                </p>
              ) : null}
              {pairing ? (
                <div
                  aria-live="polite"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={72}
                  className="submit-progress settings-dialog__progress"
                  role="progressbar"
                >
                  <div className="submit-progress__meta">
                    <strong><Localized en={"Approving Telegram"} zh={"正在批准 Telegram"} /></strong>
                    <span><Localized en={"Pairing the bot with the AI Agent instance."} zh={"正在将机器人与 AI Agent 实例配对。"} /></span>
                  </div>
                  <div className="submit-progress__track">
                    <span className="submit-progress__bar" />
                  </div>
                </div>
              ) : null}
              <div className="settings-dialog__actions">
                <button className="btn-ghost" disabled={pairing} onClick={closePairDialog} type="button">
                  <Localized en={"Cancel"} zh={"取消"} /></button>
                <button className="btn-primary btn-primary--compact" disabled={pairing} type="submit">
                  {pairing ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <KeyRound size={17} strokeWidth={1.8} />}
                  {pairing ? <Localized en={"Approving..."} zh={"正在批准..."} /> : <Localized en={"Approve Telegram"} zh={"批准 Telegram"} />}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        busy={removingId !== null}
        busyLabel="Removing..."
        closeLabel="Close remove instance dialog"
        confirmLabel="Remove instance"
        description="This tears down the AI Agent instance and removes it from the Gyne Agent."
        error={error}
        eyebrow="Danger zone"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) {
            void removeInstance(pendingRemoval.id);
          }
        }}
        open={pendingRemoval !== null}
        title={pendingRemoval ? (_uiLanguage === "zh" ? `移除 ${pendingRemoval.name}？` : `Remove ${pendingRemoval.name}?`) : (_uiLanguage === "zh" ? "移除实例？" : "Remove instance?")}
        warning="This action is destructive. Tasks routed to this consumer will stop until you provision a replacement."
      />
    </section>
  );
}
