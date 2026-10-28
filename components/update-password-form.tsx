"use client";

import { navigateToPage } from "@/lib/page-navigation";

import { useState, type FormEvent } from "react";

export function UpdatePasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", password, next }) });
      const data = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok || !data.redirectTo) throw new Error(data.error || "Could not update the password.");
      setPassword(""); setConfirmation(""); navigateToPage(data.redirectTo);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the password."); }
    finally { setBusy(false); }
  }
  return <form className="login-email" onSubmit={submit}>
    <label htmlFor="new-password">New password</label>
    <input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
    <small>At least 8 characters.</small>
    <label htmlFor="confirm-password">Confirm new password</label>
    <input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
    {error ? <p className="login-email__error" role="alert">{error}</p> : null}
    <button className="login-email__submit" type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
  </form>;
}
