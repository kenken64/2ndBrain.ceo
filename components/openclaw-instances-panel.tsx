"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X
} from "lucide-react";

type OpenClawInstance = {
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
  instance_not_found: "The OpenClaw instance could not be found.",
  instance_not_ready: "The instance is not ready for Telegram pairing yet.",
  insufficient_ai_credits: "Not enough AI credits to provision a new OpenClaw instance.",
  instance_limit_reached: "You have reached the maximum number of OpenClaw instances.",
  invalid_telegram_bot_token: "Enter a valid Telegram bot token.",
  invalid_telegram_pair_code: "Enter the 8-character approval code from Telegram.",
  missing_fields: "Finish onboarding (avatar and Telegram bot) before provisioning an instance.",
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

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
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
  const [instances, setInstances] = useState<OpenClawInstance[]>([]);
  const [maxInstances, setMaxInstances] = useState(0);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null);
  const [isProvisionDialogOpen, setIsProvisionDialogOpen] = useState(false);
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
        throw new Error(friendlyError(payload?.error, "OpenClaw instances could not be loaded."));
      }

      setInstances(payload.instances);
      setMaxInstances(payload.maxInstances);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "OpenClaw instances could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
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
        body: JSON.stringify({ telegramBotToken: token }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; instance?: OpenClawInstance }
        | null;

      if (!response.ok) {
        throw new Error(friendlyError(payload?.error, "The OpenClaw instance could not be provisioned."));
      }

      setIsProvisionDialogOpen(false);
      setIsTokenVisible(false);
      setMessage("OpenClaw instance provisioned. Open your Telegram bot, copy the 8-character approval code, and approve it to finish pairing.");
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
        provisionError instanceof Error ? provisionError.message : "The OpenClaw instance could not be provisioned."
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
        throw new Error(friendlyError(payload?.error, "The OpenClaw instance could not be removed."));
      }

      setInstances((current) => current.filter((instance) => instance.id !== id));
      setMessage("OpenClaw instance removed.");
      setPendingRemoval(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The OpenClaw instance could not be removed.");
    } finally {
      setRemovingId(null);
    }
  }

  const activeCount = instances.filter((instance) => instance.status !== "failed" && instance.status !== "stopped").length;
  const atLimit = maxInstances > 0 && activeCount >= maxInstances;
  const provisionDisabled = provisioning || atLimit;

  return (
    <section className="workflow-marketplace-stack">
      <div className="workflow-marketplace-summary">
        <div>
          <p className="workspace-status-card__eyebrow">OpenClaw instances</p>
          <h2>
            {loading
              ? "Loading OpenClaw instances"
              : maxInstances > 0
                ? `${activeCount} of ${maxInstances} in use`
                : `${activeCount} in use`}
          </h2>
          <p>Each instance is a private OpenClaw worker that only you can see and use in the Gyne Agent.</p>
        </div>
        <div className="workflow-card__actions">
          <button className="btn-ghost" disabled={loading || provisioning} onClick={refresh} type="button">
            <RefreshCw size={16} strokeWidth={1.8} />
            Refresh
          </button>
          <button
            className="btn-primary"
            disabled={provisionDisabled}
            onClick={() => setIsProvisionDialogOpen(true)}
            type="button"
          >
            {provisioning ? <RefreshCw size={16} strokeWidth={1.8} /> : <Plus size={16} strokeWidth={1.8} />}
            {provisioning ? "Provisioning..." : "Provision instance"}
          </button>
        </div>
      </div>

      {atLimit ? (
        <p className="workflow-card__hint">
          You have reached your OpenClaw instance limit. Remove an instance to provision another.
        </p>
      ) : null}
      {provisioning ? (
        <p className="workflow-card__hint">Provisioning a new instance can take a few minutes. Keep this tab open.</p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}

      {!loading && instances.length === 0 ? (
        <article className="workflow-empty">
          <div>
            <p className="workspace-status-card__eyebrow">No instances yet</p>
            <h2>Provision your first OpenClaw instance</h2>
            <p>Provisioned instances appear in the Gyne Agent so you can route tasks to them.</p>
          </div>
        </article>
      ) : null}

      {instances.length > 0 ? (
        <div className="workflow-grid">
          {instances.map((instance) => {
            const createdDate = formatDate(instance.createdAt);
            const isRemoving = removingId === instance.id;
            const canPair = instance.status === "ready" && Boolean(instance.instance);

            return (
              <article className="workflow-card" key={instance.id}>
                <div className="workflow-card__header">
                  <div>
                    <span className="workspace-status-card__eyebrow">
                      <Cpu size={14} strokeWidth={1.8} /> OpenClaw
                    </span>
                    <h2>{instance.label || instance.consumerName}</h2>
                  </div>
                  <span className={statusClass(instance.status)}>{instance.status}</span>
                </div>
                <dl className="workflow-card__allocation">
                  <div>
                    <dt>Consumer</dt>
                    <dd>{instance.consumerName}</dd>
                  </div>
                  <div>
                    <dt>Instance</dt>
                    <dd>{instance.instance ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Region</dt>
                    <dd>{instance.region ?? "—"}</dd>
                  </div>
                </dl>
                <p className="workflow-card__billing">{createdDate ? `Created: ${createdDate}.` : ""}</p>
                {instance.status === "failed" && instance.error ? (
                  <p className="workflow-card__hint">{instance.error}</p>
                ) : null}
                <div className="workflow-card__actions">
                  {canPair ? (
                    <button
                      className="btn-ghost"
                      disabled={isRemoving || pairing}
                      onClick={() =>
                        setPairTarget({ id: instance.id, name: instance.label || instance.consumerName })
                      }
                      type="button"
                    >
                      <KeyRound size={16} strokeWidth={1.8} />
                      Pair Telegram
                    </button>
                  ) : null}
                  <button
                    className="btn-ghost danger-button"
                    disabled={isRemoving}
                    onClick={() =>
                      setPendingRemoval({ id: instance.id, name: instance.label || instance.consumerName })
                    }
                    type="button"
                  >
                    <Trash2 size={16} strokeWidth={1.8} />
                    {isRemoving ? "Removing..." : "Remove"}
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
            aria-label="Close provision instance dialog"
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
              aria-label="Close provision instance dialog"
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
            <p className="workspace-status-card__eyebrow">OpenClaw instance</p>
            <h2 id="provision-instance-dialog-title">Provision a new instance</h2>
            <p>
              Each instance pairs with its own Telegram bot. Create a bot with BotFather and paste its token here. After provisioning, approve the 8-character pairing code from the bot.
            </p>
            <form className="settings-dialog__form" noValidate onSubmit={handleProvisionSubmit}>
              <label className="field-stack">
                <span>
                  <Send size={18} strokeWidth={1.8} />
                  Telegram bot token
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
                    aria-label={isTokenVisible ? "Hide Telegram bot token" : "Show Telegram bot token"}
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
                  {provisionDialogError}
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
                    <strong>Provisioning instance</strong>
                    <span>Restoring the snapshot, configuring your Telegram bot, and registering the consumer.</span>
                  </div>
                  <div className="submit-progress__track">
                    <span className="submit-progress__bar" />
                  </div>
                </div>
              ) : null}
              <div className="settings-dialog__actions">
                <button className="btn-ghost" disabled={provisioning} onClick={closeProvisionDialog} type="button">
                  Cancel
                </button>
                <button className="btn-primary btn-primary--compact" disabled={provisioning} type="submit">
                  {provisioning ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <Plus size={17} strokeWidth={1.8} />}
                  {provisioning ? "Provisioning..." : "Provision instance"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {pairTarget ? (
        <div className="settings-dialog" role="presentation">
          <button
            aria-label="Close Telegram approval dialog"
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
              aria-label="Close Telegram approval dialog"
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
            <p className="workspace-status-card__eyebrow">Telegram approval</p>
            <h2 id="pair-telegram-dialog-title">Approve Telegram on {pairTarget.name}</h2>
            <p>
              Open your Telegram bot, copy the 8-character approval code, and submit it here to pair the bot with this instance.
            </p>
            <form className="settings-dialog__form" noValidate onSubmit={handlePairSubmit}>
              <label className="field-stack">
                <span>
                  <KeyRound size={18} strokeWidth={1.8} />
                  Telegram approval code
                </span>
                <input
                  aria-describedby={pairDialogError ? pairCodeErrorId : undefined}
                  aria-invalid={Boolean(pairDialogError)}
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  disabled={pairing}
                  inputMode="text"
                  maxLength={8}
                  name="telegramPairCode"
                  placeholder="8-character code"
                  type="text"
                />
              </label>
              {pairDialogError ? (
                <p className="form-error" id={pairCodeErrorId}>
                  {pairDialogError}
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
                    <strong>Approving Telegram</strong>
                    <span>Pairing the bot with the OpenClaw instance.</span>
                  </div>
                  <div className="submit-progress__track">
                    <span className="submit-progress__bar" />
                  </div>
                </div>
              ) : null}
              <div className="settings-dialog__actions">
                <button className="btn-ghost" disabled={pairing} onClick={closePairDialog} type="button">
                  Cancel
                </button>
                <button className="btn-primary btn-primary--compact" disabled={pairing} type="submit">
                  {pairing ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <KeyRound size={17} strokeWidth={1.8} />}
                  {pairing ? "Approving..." : "Approve Telegram"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {pendingRemoval ? (
        <div className="destroy-dialog" role="presentation">
          <button
            aria-label="Close remove instance dialog"
            className="destroy-dialog__scrim"
            disabled={removingId !== null}
            onClick={() => setPendingRemoval(null)}
            type="button"
          />
          <section aria-labelledby="remove-instance-dialog-title" aria-modal="true" className="destroy-dialog__panel" role="dialog">
            <button
              aria-label="Close remove instance dialog"
              className="destroy-dialog__close"
              disabled={removingId !== null}
              onClick={() => setPendingRemoval(null)}
              type="button"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
            <div className="destroy-dialog__icon" aria-hidden="true">
              <AlertTriangle size={28} strokeWidth={1.9} />
            </div>
            <p className="workspace-status-card__eyebrow">Danger zone</p>
            <h2 id="remove-instance-dialog-title">Remove {pendingRemoval.name}?</h2>
            <p>This tears down the OpenClaw instance and removes it from the Gyne Agent.</p>
            <div className="destroy-dialog__warning">
              This action is destructive. Tasks routed to this consumer will stop until you provision a replacement.
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="destroy-dialog__actions">
              <button className="btn-ghost" disabled={removingId !== null} onClick={() => setPendingRemoval(null)} type="button">
                Cancel
              </button>
              <button className="btn-danger" disabled={removingId !== null} onClick={() => removeInstance(pendingRemoval.id)} type="button">
                {removingId !== null ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <Trash2 size={17} strokeWidth={1.8} />}
                {removingId !== null ? "Removing..." : "Remove instance"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
