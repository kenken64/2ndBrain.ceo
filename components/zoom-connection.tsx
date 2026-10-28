"use client";
import { useCallback, useEffect, useState } from "react";

type Status = {
  configured: boolean; connected: boolean; canManageProvider: boolean;
  profile: { name: string; email: string } | null;
  provider?: { clientId: string; hasClientSecret: boolean; hasWebhookSecret: boolean; revision: string; webhookUrl: string };
};
export function ZoomConnection() {
  const [appOrigin,setAppOrigin] = useState("YOUR-2NDBRAIN-ORIGIN");
  const [status,setStatus] = useState<Status|null>(null);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
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
  return <section className="settings-action-card" aria-label="Zoom connection">
    <div><p className="workspace-status-card__eyebrow">Connected apps</p><h2>Zoom</h2>
      <p>Connect once in 2ndBrain to use recordings and transcripts in Meeting Minutes. Your existing workspace login stays unchanged.</p>
      {status?.connected?<p><strong>Connected: {status.profile?.name}</strong> {status.profile?.email}</p>:<p>{status?.configured?'Zoom is ready to connect.':'An administrator needs to finish the shared Zoom provider setup.'}</p>}
      {error?<p className="form-error" role="alert">{error}</p>:null}
      {message?<p className="form-success" role="status">{message}</p>:null}
      {status?.connected?<button className="btn-ghost" disabled={busy} onClick={()=>{if(confirm('Disconnect this Zoom connection for marketplace tools? Your 2ndBrain login stays active.'))void post('disconnect');}} type="button">Disconnect Zoom</button>:null}
      {status?.configured?<form action="/api/integrations/zoom/connect" method="post"><button className="btn-primary" disabled={busy} type="submit">{status.connected?'Reconnect Zoom':'Connect Zoom'}</button></form>:null}
      <button className="btn-ghost" disabled={busy} onClick={()=>void reload()} type="button">Check connection</button>
      {status?.canManageProvider?<details><summary>Admin: shared Zoom provider configuration</summary>
        <p>Enter the same Zoom app credentials configured in Supabase → Authentication → Providers → Zoom. These are used server-side to refresh API tokens. Enable manual identity linking and allow the dedicated connection callback. Saving applies immediately and requires users to reconnect.</p>
        <form key={status.provider?.revision} autoComplete="off" onSubmit={event=>{
          event.preventDefault();const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));
          form.reset();void post('provider',{...data,revision:status.provider?.revision||'',clearWebhookSecret:data.clearWebhookSecret==='on'});
        }}>
          <label>Zoom Client ID<input name="clientId" defaultValue={status.provider?.clientId||''} required maxLength={2048}/></label>
          <label>Zoom Client Secret {status.provider?.hasClientSecret?'(saved; leave blank to keep)':''}<input name="clientSecret" type="password" autoComplete="new-password" required={!status.provider?.hasClientSecret} maxLength={2048}/></label>
          <label>Webhook Secret (optional){status.provider?.hasWebhookSecret?' — saved; leave blank to keep':''}<input name="webhookSecret" type="password" autoComplete="new-password" maxLength={2048}/></label>
          {status.provider?.hasWebhookSecret?<label><input name="clearWebhookSecret" type="checkbox"/>Remove webhook secret</label>:null}
          <button className="btn-primary" disabled={busy} type="submit">Save provider settings</button>
        </form>
        <p>Supabase redirect allow list: <code>{appOrigin}/api/integrations/zoom/callback**</code></p>
        <p>The Zoom app’s OAuth redirect remains your Supabase project’s <code>/auth/v1/callback</code>.</p>
        {status.provider?.webhookUrl?<p>Optional webhook URL: <code>{status.provider.webhookUrl}</code></p>:null}
      </details>:null}
    </div>
  </section>;
}
