"use client";

import { Localized, LocalizedMessage } from "@/components/language-provider";


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
    <label htmlFor="new-password"><Localized en={"New password"} zh={"新密码"} /></label>
    <input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
    <small><Localized en={"At least 8 characters."} zh={"至少 8 个字符。"} /></small>
    <label htmlFor="confirm-password"><Localized en={"Confirm new password"} zh={"确认新密码"} /></label>
    <input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
    {error ? <p className="login-email__error" role="alert"><LocalizedMessage text={error} /></p> : null}
    <button className="login-email__submit" type="submit" disabled={busy}>{busy ? <Localized en={"Saving…"} zh={"正在保存…"} /> : <Localized en={"Save new password"} zh={"保存新密码"} />}</button>
  </form>;
}
