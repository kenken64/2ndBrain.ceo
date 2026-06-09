"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Search, Send, UserRound } from "lucide-react";

type CreditBalance = {
  quota: number;
  used: number;
};

type TransferRecipient = {
  displayName: string | null;
  email: string;
  userId: string;
};

type AiCreditTransferProps = {
  balance: CreditBalance;
  onBalanceChange: (balance: CreditBalance) => void;
};

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function parseCreditAmount(value: string) {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed");
  }

  return payload as T;
}

export function AiCreditTransfer({ balance, onBalanceChange }: AiCreditTransferProps) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipient, setRecipient] = useState<TransferRecipient | null>(null);
  const [amount, setAmount] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const available = Math.max(0, balance.quota - balance.used);
  const parsedAmount = useMemo(() => parseCreditAmount(amount), [amount]);
  const canTransfer = Boolean(recipient && parsedAmount && parsedAmount <= available && !isTransferring);
  const canUseMax = Boolean(recipient && available > 0 && !isTransferring);

  async function searchRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = recipientEmail.trim().toLowerCase();

    setError(null);
    setMessage(null);
    setRecipient(null);

    if (!email) {
      setError("Recipient email is required.");
      return;
    }

    setIsSearching(true);

    try {
      const payload = await readJson<{ recipient: TransferRecipient }>(
        await fetch(`/api/billing/credits/recipient?email=${encodeURIComponent(email)}`, {
          method: "GET"
        })
      );

      setRecipient(payload.recipient);
      setRecipientEmail(payload.recipient.email);
      setMessage(`Ready to transfer AI credits to ${payload.recipient.email}.`);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Recipient lookup failed.");
    } finally {
      setIsSearching(false);
    }
  }

  async function transferCredits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!recipient) {
      setError("Find a recipient first.");
      return;
    }

    if (!parsedAmount) {
      setError("Enter a positive AI credit amount.");
      return;
    }

    if (parsedAmount > available) {
      setError("Transfer amount exceeds your available AI credits.");
      return;
    }

    setIsTransferring(true);

    try {
      const payload = await readJson<{
        transfer: {
          amountTokens: number;
          recipient: TransferRecipient;
          sender: {
            availableTokens: number;
            email: string | null;
            llmTokenQuota: number;
            llmTokenUsed: number;
            userId: string;
          };
          transferId: string;
        };
      }>(
        await fetch("/api/billing/credits/transfer", {
          body: JSON.stringify({
            amountTokens: parsedAmount,
            recipientEmail: recipient.email
          }),
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST"
        })
      );

      onBalanceChange({
        quota: payload.transfer.sender.llmTokenQuota,
        used: payload.transfer.sender.llmTokenUsed
      });
      setRecipient(payload.transfer.recipient);
      setAmount("");
      setMessage(`Transferred ${formatInteger(payload.transfer.amountTokens)} AI credits to ${payload.transfer.recipient.email}.`);
    } catch (transferError) {
      setError(transferError instanceof Error ? transferError.message : "AI credit transfer failed.");
    } finally {
      setIsTransferring(false);
    }
  }

  return (
    <article className="settings-action-card ai-credit-transfer-card">
      <div className="ai-credit-transfer-card__header">
        <span className="settings-toggle-card__icon" aria-hidden="true">
          <UserRound size={22} strokeWidth={1.8} />
        </span>
        <div>
          <p className="workspace-status-card__eyebrow">AI credits</p>
          <h2>Transfer AI credits</h2>
          <p>Move unused AI credits to another user in this system.</p>
        </div>
        <span className="settings-toggle-card__status">{formatInteger(available)} available</span>
      </div>

      <form className="ai-credit-transfer-card__form" noValidate onSubmit={searchRecipient}>
        <label className="field-stack">
          <span>Recipient email</span>
          <input
            autoComplete="email"
            disabled={isSearching || isTransferring}
            name="recipientEmail"
            onChange={(event) => {
              setRecipientEmail(event.target.value);
              setRecipient(null);
              setError(null);
              setMessage(null);
            }}
            placeholder="teammate@example.com"
            type="email"
            value={recipientEmail}
          />
        </label>
        <button className="btn-ghost" disabled={isSearching || isTransferring} type="submit">
          {isSearching ? <Loader2 size={16} strokeWidth={1.8} /> : <Search size={16} strokeWidth={1.8} />}
          {isSearching ? "Searching..." : "Find user"}
        </button>
      </form>

      {recipient ? (
        <div className="ai-credit-transfer-card__recipient">
          <div>
            <strong>{recipient.displayName ?? recipient.email}</strong>
            <span>{recipient.email}</span>
          </div>
          <span>Recipient confirmed</span>
        </div>
      ) : null}

      <form className="ai-credit-transfer-card__form" noValidate onSubmit={transferCredits}>
        <label className="field-stack">
          <span>AI credits</span>
          <div className="ai-credit-transfer-card__amount-field">
            <input
              disabled={!recipient || isTransferring}
              inputMode="numeric"
              min={1}
              max={available || undefined}
              name="amountTokens"
              onChange={(event) => {
                setAmount(event.target.value);
                setError(null);
                setMessage(null);
              }}
              placeholder="100000"
              step={1}
              type="number"
              value={amount}
            />
            <button
              className="ai-credit-transfer-card__max"
              disabled={!canUseMax}
              onClick={() => {
                setAmount(String(available));
                setError(null);
                setMessage(null);
              }}
              type="button"
            >
              Max
            </button>
          </div>
        </label>
        <button className="btn-primary" disabled={!canTransfer} type="submit">
          {isTransferring ? <Loader2 size={16} strokeWidth={1.8} /> : <Send size={16} strokeWidth={1.8} />}
          {isTransferring ? "Transferring..." : "Transfer credits"}
        </button>
      </form>

      {message ? (
        <div className="settings-toggle-card__status">
          <CheckCircle2 size={16} strokeWidth={1.8} />
          {message}
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </article>
  );
}
