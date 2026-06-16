"use client";

import { useEffect, useMemo, useState } from "react";
import { Buffer } from "buffer";
import { CreditCard, Loader2, Wallet } from "lucide-react";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

type PhantomProvider = {
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect?: () => Promise<void>;
  isPhantom?: boolean;
  publicKey?: PublicKey;
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
};

type SolanaEstimate = {
  packageTokens: number;
  solAmount: number;
  solAmountLamports: number;
  solUsdPrice: number;
  solanaNetwork: string;
  usdAmount: number;
  usdAmountCents: number;
};

type SolanaQuote = SolanaEstimate & {
  blockhash: string;
  expiresAt: string;
  id: string;
  label: string;
  lastValidBlockHeight: number;
  treasuryWallet: string;
  walletAddress: string;
};

type SolanaBlockhash = {
  blockhash: string;
  lastValidBlockHeight: number;
  solanaNetwork: string;
};

type CreditBalance = {
  quota: number;
  used: number;
};

type SolanaCreditPurchaseProps = {
  balance: CreditBalance;
  billingConfigured: boolean;
  onBalanceChange: (balance: CreditBalance) => void;
  onPaymentConfirmed?: () => void;
  packageTokens: number;
  packageUsdCents: number;
};

declare global {
  interface Window {
    phantom?: {
      solana?: PhantomProvider;
    };
    solana?: PhantomProvider;
  }
}

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const TRANSACTION_BLOCKHASH_REFRESH_MS = 30_000;
const TRANSACTION_BLOCKHASH_MAX_AGE_MS = 55_000;

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

function formatUsdPlain(value: number) {
  return `USD ${new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value)}`;
}

function formatSol(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 9,
    minimumFractionDigits: 6
  }).format(value);
}

function getPhantomProvider() {
  const provider = window.phantom?.solana ?? window.solana;

  return provider?.isPhantom ? provider : null;
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;

    return typeof code === "number" || typeof code === "string" ? String(code) : null;
  }

  return null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;

    return typeof message === "string" && message ? message : null;
  }

  return null;
}

function phantomPaymentErrorMessage(error: unknown, network: string | null) {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (code === "4001") {
    return "Payment was cancelled in Phantom.";
  }

  if (code === "-32002") {
    return "A Phantom request is already open. Approve or close it, then try again.";
  }

  if (message && !/unexpected error/i.test(message)) {
    return message;
  }

  const networkCopy = network ? ` Phantom must be set to ${network}.` : "";

  return `Phantom rejected the transaction.${networkCopy} Check that the wallet has enough Solana and try again.`;
}

function isFreshTransactionBlockhash(
  quote: SolanaQuote | null,
  blockhash: SolanaBlockhash | null,
  fetchedAt: number | null
) {
  return Boolean(
    quote &&
      blockhash &&
      blockhash.solanaNetwork === quote.solanaNetwork &&
      fetchedAt &&
      Date.now() - fetchedAt < TRANSACTION_BLOCKHASH_MAX_AGE_MS
  );
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed");
  }

  return payload as T;
}

export function SolanaCreditPurchase({
  balance,
  billingConfigured,
  onBalanceChange,
  onPaymentConfirmed,
  packageTokens,
  packageUsdCents
}: SolanaCreditPurchaseProps) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<SolanaEstimate | null>(null);
  const [quote, setQuote] = useState<SolanaQuote | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isRefreshingBlockhash, setIsRefreshingBlockhash] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [hasCompletedPayment, setHasCompletedPayment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transactionBlockhash, setTransactionBlockhash] = useState<SolanaBlockhash | null>(null);
  const [transactionBlockhashFetchedAt, setTransactionBlockhashFetchedAt] = useState<number | null>(null);
  const quota = balance.quota;
  const used = balance.used;
  const remaining = Math.max(0, quota - used);
  const packageUsd = packageUsdCents / 100;
  const hasFreshBlockhash = isFreshTransactionBlockhash(
    quote,
    transactionBlockhash,
    transactionBlockhashFetchedAt
  );
  const packageSummaryCopy = useMemo(() => {
    if (quote) {
      return `Minimum spend is ${formatUsdPlain(packageUsd)}, approximately ${formatSol(quote.solAmount)} Solana at the current payment quote, for ${formatInteger(packageTokens)} AI credits.`;
    }

    if (estimate) {
      return `Minimum spend is ${formatUsdPlain(packageUsd)}, approximately ${formatSol(estimate.solAmount)} Solana at the current estimate, for ${formatInteger(packageTokens)} AI credits.`;
    }

    if (isEstimating) {
      return `Minimum spend is ${formatUsdPlain(packageUsd)}. Calculating the approximate Solana amount for ${formatInteger(packageTokens)} AI credits.`;
    }

    return `Minimum spend is ${formatUsdPlain(packageUsd)}, paid in Solana, for ${formatInteger(packageTokens)} AI credits.`;
  }, [estimate, isEstimating, packageTokens, packageUsd, quote]);
  const statusCopy = useMemo(() => {
    if (!billingConfigured) {
      return "Treasury wallet missing";
    }

    if (quote) {
      if (isRefreshingBlockhash || !hasFreshBlockhash) {
        return "Refreshing Solana";
      }

      return `${formatSol(quote.solAmount)} Solana estimated`;
    }

    if (isQuoting || isEstimating) {
      return "Calculating Solana";
    }

    if (estimate) {
      return `${formatSol(estimate.solAmount)} Solana estimated`;
    }

    if (walletAddress) {
      return "Wallet connected";
    }

    return "Ready";
  }, [billingConfigured, estimate, hasFreshBlockhash, isEstimating, isQuoting, isRefreshingBlockhash, quote, walletAddress]);

  useEffect(() => {
    if (!billingConfigured) {
      setEstimate(null);
      setIsEstimating(false);
      return;
    }

    let cancelled = false;

    async function createEstimate() {
      setIsEstimating(true);

      try {
        const payload = await readJson<{ estimate: SolanaEstimate }>(
          await fetch("/api/billing/solana/estimate", {
            method: "GET"
          })
        );

        if (!cancelled) {
          setEstimate(payload.estimate);
        }
      } catch {
        if (!cancelled) {
          setEstimate(null);
        }
      } finally {
        if (!cancelled) {
          setIsEstimating(false);
        }
      }
    }

    void createEstimate();

    return () => {
      cancelled = true;
    };
  }, [billingConfigured]);

  useEffect(() => {
    if (!quote || !walletAddress) {
      return;
    }

    const expiresAt = Date.parse(quote.expiresAt);

    if (!Number.isFinite(expiresAt)) {
      return;
    }

    const refreshDelay = Math.max(0, expiresAt - Date.now() - 15_000);
    const timeout = window.setTimeout(() => {
      void createQuoteForWallet(walletAddress, { silent: true });
    }, refreshDelay);

    return () => window.clearTimeout(timeout);
  }, [quote?.expiresAt, quote?.id, walletAddress]);

  useEffect(() => {
    if (!quote || !walletAddress) {
      setTransactionBlockhash(null);
      setTransactionBlockhashFetchedAt(null);
      return;
    }

    const interval = window.setInterval(() => {
      void refreshTransactionBlockhash({ silent: true });
    }, TRANSACTION_BLOCKHASH_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [quote?.id, quote?.solanaNetwork, walletAddress]);

  async function connectWallet() {
    setIsConnecting(true);
    setError(null);
    setMessage(null);

    try {
      const provider = getPhantomProvider();

      if (!provider) {
        throw new Error("Phantom wallet is not available in this browser.");
      }

      const connection = await provider.connect();
      const address = connection.publicKey.toBase58();

      setWalletAddress(address);
      setQuote(null);
      setHasCompletedPayment(false);
      setMessage("Phantom connected. Calculating Solana amount...");
      void createQuoteForWallet(address);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Unable to connect Phantom.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnectWallet() {
    setIsConnecting(true);
    setError(null);
    setMessage(null);

    try {
      const provider = getPhantomProvider();

      if (provider?.disconnect) {
        await provider.disconnect();
      }

      setWalletAddress(null);
      setQuote(null);
      setHasCompletedPayment(false);
      setTransactionBlockhash(null);
      setTransactionBlockhashFetchedAt(null);
      setMessage("Phantom disconnected.");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect Phantom.");
    } finally {
      setIsConnecting(false);
    }
  }

  function handleWalletAction() {
    return walletAddress ? disconnectWallet() : connectWallet();
  }

  function handlePrimaryAction() {
    if (quote) {
      void payWithPhantom();
      return;
    }

    void createQuoteForWallet(walletAddress);
  }

  function primaryActionLabel() {
    if (isQuoting && !quote) {
      return "Calculating...";
    }

    if (isRefreshingBlockhash) {
      return "Refreshing...";
    }

    return quote ? "Pay with Phantom" : hasCompletedPayment ? "Buy again" : "Calculate payment";
  }

  async function createQuoteForWallet(address: string | null, options?: { silent?: boolean }) {
    if (!address) {
      setError("Connect Phantom first.");
      return;
    }

    setIsQuoting(true);
    setHasCompletedPayment(false);
    setError(null);
    setMessage(options?.silent ? null : "Calculating Solana amount...");

    try {
      const payload = await readJson<{ quote: SolanaQuote }>(
        await fetch("/api/billing/solana/quote", {
          body: JSON.stringify({ walletAddress: address }),
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST"
        })
      );

      setQuote(payload.quote);
      setTransactionBlockhash({
        blockhash: payload.quote.blockhash,
        lastValidBlockHeight: payload.quote.lastValidBlockHeight,
        solanaNetwork: payload.quote.solanaNetwork
      });
      setTransactionBlockhashFetchedAt(Date.now());
      setMessage(
        `Estimated Solana payment expires ${new Date(payload.quote.expiresAt).toLocaleTimeString()}. Use Phantom on ${payload.quote.solanaNetwork}.`
      );
    } catch (quoteError) {
      setQuote(null);
      setTransactionBlockhash(null);
      setTransactionBlockhashFetchedAt(null);
      setError(quoteError instanceof Error ? quoteError.message : "Unable to calculate Solana amount.");
    } finally {
      setIsQuoting(false);
    }
  }

  async function refreshTransactionBlockhash(options?: { silent?: boolean }) {
    if (!quote || !walletAddress) {
      return;
    }

    setIsRefreshingBlockhash(true);

    if (!options?.silent) {
      setMessage("Refreshing Solana transaction data...");
    }

    try {
      const payload = await readJson<{ blockhash: SolanaBlockhash }>(
        await fetch("/api/billing/solana/blockhash", {
          method: "GET"
        })
      );

      if (payload.blockhash.solanaNetwork !== quote.solanaNetwork) {
        throw new Error("Solana network changed after the estimate was created. Reconnect Phantom and try again.");
      }

      setTransactionBlockhash(payload.blockhash);
      setTransactionBlockhashFetchedAt(Date.now());
    } catch (blockhashError) {
      if (!options?.silent) {
        setError(blockhashError instanceof Error ? blockhashError.message : "Unable to refresh Solana transaction data.");
      }
    } finally {
      setIsRefreshingBlockhash(false);
    }
  }

  async function payWithPhantom() {
    if (!quote || !walletAddress) {
      setError("Create a quote first.");
      return;
    }

    setIsPaying(true);
    setError(null);
    setMessage(null);

    try {
      const provider = getPhantomProvider();

      if (!provider) {
        throw new Error("Phantom wallet is not available in this browser.");
      }

      if (Date.now() > Date.parse(quote.expiresAt)) {
        setQuote(null);
        setTransactionBlockhash(null);
        setTransactionBlockhashFetchedAt(null);
        void createQuoteForWallet(walletAddress);
        throw new Error("The Solana estimate expired. A fresh estimate is being calculated.");
      }

      if (!isFreshTransactionBlockhash(quote, transactionBlockhash, transactionBlockhashFetchedAt) || !transactionBlockhash) {
        void refreshTransactionBlockhash();
        throw new Error("Solana transaction data was refreshing. Try Pay again in a moment.");
      }

      const providerAddress = provider.publicKey?.toBase58();

      if (providerAddress && providerAddress !== walletAddress) {
        throw new Error("Phantom is connected to a different wallet. Disconnect and connect the quoted wallet.");
      }

      const fromPublicKey = new PublicKey(walletAddress);
      const transaction = new Transaction({
        feePayer: fromPublicKey,
        recentBlockhash: transactionBlockhash.blockhash
      });

      transaction.add(
        SystemProgram.transfer({
          fromPubkey: fromPublicKey,
          lamports: quote.solAmountLamports,
          toPubkey: new PublicKey(quote.treasuryWallet)
        })
      );
      transaction.add(
        new TransactionInstruction({
          data: Buffer.from(`2ndBrain quote ${quote.id}`),
          keys: [],
          programId: MEMO_PROGRAM_ID
        })
      );

      setMessage("Review the transaction in Phantom.");
      const { signature } = await provider.signAndSendTransaction(transaction);
      setMessage("Payment sent. Confirming on Solana...");

      const payload = await readJson<{
        credit: {
          addedTokens: number;
          llmTokenQuota: number;
          llmTokenUsed: number;
          paymentId?: string;
        };
        ok: boolean;
      }>(
        await fetch("/api/billing/solana/confirm", {
          body: JSON.stringify({
            quoteId: quote.id,
            signature,
            walletAddress
          }),
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST"
        })
      );

      onBalanceChange({
        quota: payload.credit.llmTokenQuota,
        used: payload.credit.llmTokenUsed
      });
      setQuote(null);
      setTransactionBlockhash(null);
      setTransactionBlockhashFetchedAt(null);
      setHasCompletedPayment(true);
      setMessage(`Credited ${formatInteger(payload.credit.addedTokens)} AI credits.`);
      onPaymentConfirmed?.();
    } catch (paymentError) {
      if (/unexpected error/i.test(errorMessage(paymentError) ?? "")) {
        void refreshTransactionBlockhash({ silent: true });
      }

      setError(phantomPaymentErrorMessage(paymentError, quote?.solanaNetwork ?? null));
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <article className="settings-action-card solana-credit-card">
      <div className="solana-credit-card__header">
        <span className="settings-toggle-card__icon" aria-hidden="true">
          <CreditCard size={22} strokeWidth={1.8} />
        </span>
        <div>
          <p className="workspace-status-card__eyebrow">AI credits</p>
          <h2>Buy AI credits with Solana</h2>
          <p>{packageSummaryCopy}</p>
        </div>
        <span className="settings-toggle-card__status">{statusCopy}</span>
      </div>

      <dl className="solana-credit-card__metrics">
        <div>
          <dt>Available</dt>
          <dd>{formatInteger(remaining)}</dd>
        </div>
        <div>
          <dt>Quota</dt>
          <dd>{formatInteger(quota)}</dd>
        </div>
        <div>
          <dt>Used</dt>
          <dd>{formatInteger(used)}</dd>
        </div>
      </dl>

      {quote ? (
        <dl className="solana-credit-card__quote">
          <div>
            <dt>Solana price</dt>
            <dd>{formatUsd(quote.solUsdPrice)}</dd>
          </div>
          <div>
            <dt>Pay</dt>
            <dd>{formatSol(quote.solAmount)} Solana</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{quote.solanaNetwork}</dd>
          </div>
        </dl>
      ) : null}

      <div className="settings-dialog__actions solana-credit-card__actions">
        <button
          className="btn-ghost"
          disabled={!billingConfigured || isConnecting || isQuoting || isPaying}
          onClick={handleWalletAction}
          type="button"
        >
          {isConnecting ? <Loader2 size={16} strokeWidth={1.8} /> : <Wallet size={16} strokeWidth={1.8} />}
          {walletAddress ? "Disconnect Phantom" : "Connect Phantom"}
        </button>
        <button
          className="btn-primary"
          disabled={!billingConfigured || !walletAddress || isQuoting || isRefreshingBlockhash || isPaying}
          onClick={handlePrimaryAction}
          type="button"
        >
          {isPaying || isQuoting || isRefreshingBlockhash ? <Loader2 size={16} strokeWidth={1.8} /> : null}
          {primaryActionLabel()}
        </button>
      </div>

      {walletAddress ? <p className="solana-credit-card__wallet">{walletAddress}</p> : null}
      {quote ? (
        <p className="settings-toggle-card__note">
          Phantom must be set to {quote.solanaNetwork} before payment.
        </p>
      ) : null}
      {message ? <p className="settings-toggle-card__note">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </article>
  );
}
