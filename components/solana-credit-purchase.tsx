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

type SolanaQuote = {
  blockhash: string;
  expiresAt: string;
  id: string;
  label: string;
  lastValidBlockHeight: number;
  packageTokens: number;
  solAmount: number;
  solAmountLamports: number;
  solUsdPrice: number;
  solanaNetwork: string;
  treasuryWallet: string;
  usdAmount: number;
  walletAddress: string;
};

type SolanaCreditPurchaseProps = {
  billingConfigured: boolean;
  initialQuota: number;
  initialUsed: number;
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

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed");
  }

  return payload as T;
}

export function SolanaCreditPurchase({
  billingConfigured,
  initialQuota,
  initialUsed,
  packageTokens,
  packageUsdCents
}: SolanaCreditPurchaseProps) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [quote, setQuote] = useState<SolanaQuote | null>(null);
  const [quota, setQuota] = useState(initialQuota);
  const [used, setUsed] = useState(initialUsed);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remaining = Math.max(0, quota - used);
  const packageUsd = packageUsdCents / 100;
  const statusCopy = useMemo(() => {
    if (!billingConfigured) {
      return "Treasury wallet missing";
    }

    if (quote) {
      return `${formatSol(quote.solAmount)} Solana estimated`;
    }

    if (isQuoting) {
      return "Calculating Solana";
    }

    if (walletAddress) {
      return "Wallet connected";
    }

    return "Ready";
  }, [billingConfigured, isQuoting, quote, walletAddress]);

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

  async function createQuoteForWallet(address: string | null, options?: { silent?: boolean }) {
    if (!address) {
      setError("Connect Phantom first.");
      return;
    }

    setIsQuoting(true);
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
      setMessage(
        `Estimated Solana payment expires ${new Date(payload.quote.expiresAt).toLocaleTimeString()}. Use Phantom on ${payload.quote.solanaNetwork}.`
      );
    } catch (quoteError) {
      setQuote(null);
      setError(quoteError instanceof Error ? quoteError.message : "Unable to calculate Solana amount.");
    } finally {
      setIsQuoting(false);
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
        void createQuoteForWallet(walletAddress);
        throw new Error("The Solana estimate expired. A fresh estimate is being calculated.");
      }

      const providerAddress = provider.publicKey?.toBase58();

      if (providerAddress && providerAddress !== walletAddress) {
        throw new Error("Phantom is connected to a different wallet. Disconnect and connect the quoted wallet.");
      }

      const fromPublicKey = new PublicKey(walletAddress);
      const transaction = new Transaction({
        feePayer: fromPublicKey,
        recentBlockhash: quote.blockhash
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

      setQuota(payload.credit.llmTokenQuota);
      setUsed(payload.credit.llmTokenUsed);
      setQuote(null);
      setMessage(`Credited ${formatInteger(payload.credit.addedTokens)} AI credits.`);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Payment could not be confirmed.");
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
          <p>{formatUsd(packageUsd)} adds {formatInteger(packageTokens)} AI credits.</p>
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
          disabled={!billingConfigured || !quote || isQuoting || isPaying}
          onClick={payWithPhantom}
          type="button"
        >
          {isPaying || isQuoting ? <Loader2 size={16} strokeWidth={1.8} /> : null}
          {isQuoting && !quote ? "Calculating..." : "Pay with Phantom"}
        </button>
      </div>

      {walletAddress ? <p className="solana-credit-card__wallet">{walletAddress}</p> : null}
      {message ? <p className="settings-toggle-card__note">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </article>
  );
}
