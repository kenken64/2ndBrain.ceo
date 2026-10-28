"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Eye, EyeOff, Video } from "lucide-react";

type Status = {
  configured: boolean; connected: boolean; canManageProvider: boolean;
  profile: { name: string; email: string } | null;
  provider?: { clientId: string; hasClientSecret: boolean; hasWebhookSecret: boolean; revision: string; webhookUrl: string };
};

type CredentialName = "clientId" | "clientSecret" | "webhookSecret";
function ZoomCredentialField({ name, label, description, value, required, visible, onToggle }: {
  name: CredentialName; label: string; description?: string; value?: string; required?: boolean; visible: boolean; onToggle: () => void;
}) {
  const id = useId();
  const toggleLabel = `${visible ? "Hide" : "Show"} ${label}`;
  return <div className="field-stack">
    <label htmlFor={id}><span>{label}{description ? ` ${description}` : ""}</span></label>
    <div className="secret-input">
      <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={name === "clientId" ? "off" : "new-password"} defaultValue={value} required={required} maxLength={2048} />
      <button className="secret-input__toggle" type="button" aria-label={toggleLabel} title={toggleLabel} aria-pressed={visible} onClick={onToggle}>
        {visible ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
      </button>
    </div>
  </div>;
}

export function ZoomConnection() {
  const [appOrigin,setAppOrigin] = useState("YOUR-2NDBRAIN-ORIGIN");
  const [status,setStatus] = useState<Status|null>(null);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [visibleCredentials, setVisibleCredentials] = useState<Record<CredentialName, boolean>>({ clientId: false, clientSecret: false, webhookSecret: false });
  function hideCredentials() { setVisibleCredentials({ clientId: false, clientSecret: false, webhookSecret: false }); }
  function toggleCredential(name: CredentialName) { setVisibleCredentials(current => ({ ...current, [name]: !current[name] })); }
  const reload = useCallback(async () => {
    try {
      const r=await fetch('/api/integrations/zoom/status',{cache:'no-store'});const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Zoom status unavailable.');
      setStatus(data);setError("");
    }catch(e){setError(e instanceof Error?e.message:'Zoom status unavailable.');}
  },[]);
  useEffect(()=>{
    setAppOrigin(location.origin);
    void reload();
    const value=new URL(location.href).searchParams.get('zoom');
    if(value)setMessage(value==='connected'?'Zoom is connected. Your original 2ndBrain login is unchanged.':'Zoom was not connected. Your original login is unchanged. Check the setup and try again.');
    window.addEventListener('focus',reload);return()=>window.removeEventListener('focus',reload);
  },[reload]);
  async function post(action:string,body?:unknown){
    setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch('/api/integrations/zoom/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'Zoom settings could not be saved.');
      setMessage(data.message||'Saved.');await reload();
    }catch(e){setError(e instanceof Error?e.message:'Zoom settings could not be saved.');}finally{setBusy(false);}
  }
  return <section className="settings-toggle-card settings-zoom-card" aria-label="Zoom connection">
    <div className="settings-toggle-card__icon" aria-hidden="true"><Video size={24} strokeWidth={1.8} /></div>
    <div className="settings-toggle-card__body"><p className="workspace-status-card__eyebrow">Zoom</p><h3>Connect Zoom</h3>
      <p>Connect once in 2ndBrain to use recordings and transcripts in Meeting Minutes. Your existing workspace login stays unchanged.</p>
      {status?.connected?<p className="settings-toggle-card__status settings-zoom-card__status">Connected{status.profile?.name ? `: ${status.profile.name}` : ''}{status.profile?.email ? ` · ${status.profile.email}` : ''}</p>:<p className="settings-toggle-card__note">{!status ? (error ? 'Zoom connection status is unavailable.' : 'Checking Zoom connection…') : status.configured?'Zoom is ready to connect.':'An administrator needs to finish the shared Zoom provider setup.'}</p>}
      {error?<p className="form-error" role="alert">{error}</p>:null}
      {message?<p className="form-success" role="status">{message}</p>:null}
      <div className="settings-zoom-card__actions">
        {status?.configured?<form action="/api/integrations/zoom/connect" method="post"><button className="btn-primary btn-primary--compact" disabled={busy} type="submit">{status.connected?'Reconnect Zoom':'Connect Zoom'}</button></form>:null}
        {status?.connected?<button className="btn-ghost btn-ghost--compact" disabled={busy} onClick={()=>{if(confirm('Disconnect this Zoom connection for marketplace tools? Your 2ndBrain login stays active.'))void post('disconnect');}} type="button">Disconnect Zoom</button>:null}
        <button className="btn-ghost btn-ghost--compact" disabled={busy} onClick={()=>void reload()} type="button">Check connection</button>
      </div>
      {status?.canManageProvider?<details className="settings-zoom-card__admin" onToggle={event => { if (!event.currentTarget.open) hideCredentials(); }}><summary>Admin: shared Zoom provider configuration</summary>
        <p>Enter the same Zoom app credentials configured in Supabase → Authentication → Providers → Zoom. These are used server-side to refresh API tokens. Enable manual identity linking and allow the dedicated connection callback. Saving applies immediately and requires users to reconnect.</p>
        <form className="settings-zoom-card__form" key={status.provider?.revision} autoComplete="off" onSubmit={event=>{
          event.preventDefault();const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));
          form.reset();hideCredentials();void post('provider',{...data,revision:status.provider?.revision||'',clearWebhookSecret:data.clearWebhookSecret==='on'});
        }}>
          <ZoomCredentialField name="clientId" label="Zoom Client ID" value={status.provider?.clientId||''} required visible={visibleCredentials.clientId} onToggle={() => toggleCredential("clientId")} />
          <ZoomCredentialField name="clientSecret" label="Zoom Client Secret" description={status.provider?.hasClientSecret?'(saved; leave blank to keep)':undefined} required={!status.provider?.hasClientSecret} visible={visibleCredentials.clientSecret} onToggle={() => toggleCredential("clientSecret")} />
          <ZoomCredentialField name="webhookSecret" label="Webhook Secret" description={status.provider?.hasWebhookSecret?'(optional; saved; leave blank to keep)':'(optional)'} visible={visibleCredentials.webhookSecret} onToggle={() => toggleCredential("webhookSecret")} />
          {status.provider?.hasWebhookSecret?<label className="settings-zoom-card__checkbox"><input name="clearWebhookSecret" type="checkbox"/>Remove webhook secret</label>:null}
          <button className="btn-primary btn-primary--compact" disabled={busy} type="submit">Save provider settings</button>
        </form>
        <p>Supabase redirect allow list: <code>{appOrigin}/api/integrations/zoom/callback**</code></p>
        <p>The Zoom app’s OAuth redirect remains your Supabase project’s <code>/auth/v1/callback</code>.</p>
        {status.provider?.webhookUrl?<p>Optional webhook URL: <code>{status.provider.webhookUrl}</code></p>:null}
      </details>:null}
    </div>
  </section>;
}
