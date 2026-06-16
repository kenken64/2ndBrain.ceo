"use client";

import { ExternalLink, ReceiptText } from "lucide-react";
import type { SolanaPaymentHistoryItem } from "@/types/solana-payment-history";

type SolanaPaymentHistoryProps = {
  emptyCopy?: string;
  eyebrow?: string;
  payments: SolanaPaymentHistoryItem[];
  showUser?: boolean;
  title?: string;
};

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(Math.max(0, Math.trunc(value)));
}

function formatSol(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 9,
    minimumFractionDigits: 6
  }).format(value);
}

function formatUsdFromCents(value: number) {
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(value / 100);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Pending timestamp";
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Invalid timestamp";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric"
  }).format(new Date(timestamp));
}

function shortenMiddle(value: string, head = 6, tail = 6) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function explorerUrl(signature: string, network: string | null) {
  const cluster = network && network !== "mainnet-beta" ? `?cluster=${encodeURIComponent(network)}` : "";

  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster}`;
}

export function SolanaPaymentHistory({
  emptyCopy = "No Solana top-ups yet.",
  eyebrow = "Solana billing",
  payments,
  showUser = false,
  title = "Top-up history"
}: SolanaPaymentHistoryProps) {
  const totalUsdCents = payments.reduce((sum, payment) => sum + payment.usdAmountCents, 0);
  const totalTokens = payments.reduce((sum, payment) => sum + payment.packageTokens, 0);

  return (
    <article className="settings-action-card solana-payment-history">
      <div className="solana-payment-history__header">
        <span className="settings-toggle-card__icon" aria-hidden="true">
          <ReceiptText size={22} strokeWidth={1.8} />
        </span>
        <div>
          <p className="workspace-status-card__eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>
            {payments.length > 0
              ? `${formatInteger(totalTokens)} AI credits purchased across ${formatInteger(payments.length)} confirmed Solana top-ups.`
              : emptyCopy}
          </p>
        </div>
        <span className="settings-toggle-card__status">{formatUsdFromCents(totalUsdCents)}</span>
      </div>

      {payments.length > 0 ? (
        <div className={`solana-payment-history__table${showUser ? " solana-payment-history__table--admin" : ""}`}>
          <div className="solana-payment-history__head" role="row">
            <span>Date</span>
            {showUser ? <span>User</span> : null}
            <span>Top-up</span>
            <span>Wallet</span>
            <span>Transaction</span>
          </div>
          {payments.map((payment) => (
            <div className="solana-payment-history__row" key={payment.id} role="row">
              <div>
                <strong>{formatDateTime(payment.transactionBlockTime ?? payment.createdAt)}</strong>
                <span>{payment.solanaNetwork ?? "network unknown"}</span>
              </div>
              {showUser ? (
                <div>
                  <strong>{payment.userEmail ?? "No email"}</strong>
                  <span>{payment.userName ?? shortenMiddle(payment.userId, 8, 8)}</span>
                </div>
              ) : null}
              <div>
                <strong>{formatUsdFromCents(payment.usdAmountCents)}</strong>
                <span>
                  {formatSol(payment.solAmount)} SOL for {formatInteger(payment.packageTokens)} credits
                </span>
              </div>
              <div>
                <strong>{shortenMiddle(payment.walletAddress)}</strong>
                <span>{shortenMiddle(payment.treasuryWallet)} treasury</span>
              </div>
              <div>
                <a href={explorerUrl(payment.signature, payment.solanaNetwork)} rel="noreferrer" target="_blank">
                  {shortenMiddle(payment.signature)}
                  <ExternalLink aria-hidden="true" size={13} strokeWidth={2} />
                </a>
                <span>{payment.status}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
