"use client";

import { useMemo, useState } from "react";
import { Buffer } from "buffer";
import { CreditCard, Loader2, Wallet } from "lucide-react";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

type PhantomProvider = {
  connect: () => Promise<{ publicKey: PublicKey }>;
  isPhantom?: boolean;
  publicKey?: PublicKey;
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
};

type SolanaQuote = {
  blockhash: string;
  expiresAt: string;
  id: string;
  label: string;
  packageTokens: number;
  solAmount: number;
  solAmountLamports: number;
  solUsdPrice: number;
  solanaNetwork: string;
  treasuryWallet: string;
  usdAmount: number;
  walletAddress: string;
};

type SolanaBlockhash = {
  blockhash: string;
  lastValidBlockHeight: number;
  solanaNetwork: string;
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
      return `${formatSol(quote.solAmount)} SOL quoted`;
    }

    if (walletAddress) {
      return "Wallet connected";
    }

    return "Ready";
  }, [billingConfigured, quote, walletAddress]);

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
      setMessage("Phantom connected.");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Unable to connect Phantom.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function createQuote() {
    if (!walletAddress) {
      setError("Connect Phantom first.");
      return;
    }

    setIsQuoting(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await readJson<{ quote: SolanaQuote }>(
        await fetch("/api/billing/solana/quote", {
          body: JSON.stringify({ walletAddress }),
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST"
        })
      );

      setQuote(payload.quote);
      setMessage(
        `Quote expires ${new Date(payload.quote.expiresAt).toLocaleTimeString()}. Use Phantom on ${payload.quote.solanaNetwork}.`
      );
    } catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "Unable to create quote.");
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

      const blockhashPayload = await readJson<{ blockhash: SolanaBlockhash }>(
        await fetch("/api/billing/solana/blockhash", {
          method: "GET"
        })
      );

      if (blockhashPayload.blockhash.solanaNetwork !== quote.solanaNetwork) {
        throw new Error("Solana network changed after quote creation. Refresh the quote and try again.");
      }

      const fromPublicKey = new PublicKey(walletAddress);
      const transaction = new Transaction({
        feePayer: fromPublicKey,
        recentBlockhash: blockhashPayload.blockhash.blockhash
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
      setMessage(`Credited ${formatInteger(payload.credit.addedTokens)} AI tokens.`);
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
          <h2>Buy AI tokens with SOL</h2>
          <p>{formatUsd(packageUsd)} adds {formatInteger(packageTokens)} internal AI tokens.</p>
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
            <dt>SOL price</dt>
            <dd>{formatUsd(quote.solUsdPrice)}</dd>
          </div>
          <div>
            <dt>Pay</dt>
            <dd>{formatSol(quote.solAmount)} SOL</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{quote.solanaNetwork}</dd>
          </div>
        </dl>
      ) : null}

      <div className="settings-dialog__actions solana-credit-card__actions">
        <button className="btn-ghost" disabled={!billingConfigured || isConnecting || isPaying} onClick={connectWallet} type="button">
          {isConnecting ? <Loader2 size={16} strokeWidth={1.8} /> : <Wallet size={16} strokeWidth={1.8} />}
          {walletAddress ? "Reconnect Phantom" : "Connect Phantom"}
        </button>
        <button
          className="btn-ghost"
          disabled={!billingConfigured || !walletAddress || isQuoting || isPaying}
          onClick={createQuote}
          type="button"
        >
          {isQuoting ? <Loader2 size={16} strokeWidth={1.8} /> : null}
          {quote ? "Refresh quote" : "Get SOL quote"}
        </button>
        <button
          className="btn-primary"
          disabled={!billingConfigured || !quote || isPaying}
          onClick={payWithPhantom}
          type="button"
        >
          {isPaying ? <Loader2 size={16} strokeWidth={1.8} /> : null}
          Pay with Phantom
        </button>
      </div>

      {walletAddress ? <p className="solana-credit-card__wallet">{walletAddress}</p> : null}
      {message ? <p className="settings-toggle-card__note">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </article>
  );
}
