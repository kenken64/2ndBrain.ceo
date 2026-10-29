"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";

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
  const language = useLanguage().language;
  const toggleLabel = language === "zh" ? `${visible ? "隐藏" : "显示"} ${label}` : `${visible ? "Hide" : "Show"} ${label}`;
  return <div className="field-stack">
    <label htmlFor={id}><span>{label}{description ? <> <LocalizedMessage text={description} /></> : ""}</span></label>
    <div className="secret-input">
      <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={name === "clientId" ? "off" : "new-password"} defaultValue={value} required={required} maxLength={2048} />
      <button className="secret-input__toggle" type="button" aria-label={toggleLabel} title={toggleLabel} aria-pressed={visible} onClick={onToggle}>
        {visible ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
      </button>
    </div>
  </div>;
}

export function ZoomConnection() {
  const _uiLanguage = useLanguage().language;
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
  return <section className="settings-toggle-card settings-zoom-card" aria-label={_uiLanguage === "zh" ? "Zoom 连接" : "Zoom connection"}>
    <div className="settings-toggle-card__icon" aria-hidden="true"><Video size={24} strokeWidth={1.8} /></div>
    <div className="settings-toggle-card__body"><p className="workspace-status-card__eyebrow">Zoom</p><h3><Localized en={"Connect Zoom"} zh={"连接 Zoom"} /></h3>
      <p><Localized en={"Connect once in 2ndBrain to use recordings and transcripts in Meeting Minutes. Your existing workspace login stays unchanged."} zh={"在 2ndBrain 中连接一次，即可在会议纪要中使用录音和转录。现有工作空间登录方式保持不变。"} /></p>
      {status?.connected?<p className="settings-toggle-card__status settings-zoom-card__status"><Localized en={"Connected"} zh={"已连接"} />{status.profile?.name ? `: ${status.profile.name}` : ''}{status.profile?.email ? ` · ${status.profile.email}` : ''}</p>:<p className="settings-toggle-card__note">{!status ? (error ? <Localized en={"Zoom connection status is unavailable."} zh={"无法获取 Zoom 连接状态。"} /> : <Localized en={"Checking Zoom connection…"} zh={"正在检查 Zoom 连接…"} />) : status.configured?<Localized en={"Zoom is ready to connect."} zh={"Zoom 已准备好连接。"} />:<Localized en={"An administrator needs to finish the shared Zoom provider setup."} zh={"管理员需要完成共享 Zoom 提供商设置。"} />}</p>}
      {error?<p className="form-error" role="alert"><LocalizedMessage text={error} /></p>:null}
      {message?<p className="form-success" role="status"><LocalizedMessage text={message} /></p>:null}
      <div className="settings-zoom-card__actions">
        {status?.configured?<form action="/api/integrations/zoom/connect" method="post"><button className="btn-primary btn-primary--compact" disabled={busy} type="submit">{status.connected?<Localized en={"Reconnect Zoom"} zh={"重新连接 Zoom"} />:<Localized en={"Connect Zoom"} zh={"连接 Zoom"} />}</button></form>:null}
        {status?.connected?<button className="btn-ghost btn-ghost--compact" disabled={busy} onClick={()=>{if(confirm(_uiLanguage === 'zh' ? '断开应用市场工具使用的 Zoom 连接？您的 2ndBrain 登录仍保持有效。' : 'Disconnect this Zoom connection for marketplace tools? Your 2ndBrain login stays active.'))void post('disconnect');}} type="button"><Localized en={"Disconnect Zoom"} zh={"断开 Zoom"} /></button>:null}
        <button className="btn-ghost btn-ghost--compact" disabled={busy} onClick={()=>void reload()} type="button"><Localized en={"Check connection"} zh={"检查连接"} /></button>
      </div>
      {status?.canManageProvider?<details className="settings-zoom-card__admin" onToggle={event => { if (!event.currentTarget.open) hideCredentials(); }}><summary><Localized en={"Admin: shared Zoom provider configuration"} zh={"管理员：共享 Zoom 提供商配置"} /></summary>
        <p><Localized en="Enter the same Zoom app credentials configured in Supabase → Authentication → Providers → Zoom. These are used server-side to refresh API tokens. Enable manual identity linking and allow the dedicated connection callback. Saving applies immediately and requires users to reconnect." zh="输入与 Supabase → Authentication → Providers → Zoom 中相同的 Zoom 应用凭据。服务器使用这些凭据刷新 API 令牌。请启用手动身份关联并允许专用连接回调。保存后立即生效，用户需要重新连接。" /></p>
        <form className="settings-zoom-card__form" key={status.provider?.revision} autoComplete="off" onSubmit={event=>{
          event.preventDefault();const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));
          form.reset();hideCredentials();void post('provider',{...data,revision:status.provider?.revision||'',clearWebhookSecret:data.clearWebhookSecret==='on'});
        }}>
          <ZoomCredentialField name="clientId" label="Zoom Client ID" value={status.provider?.clientId||''} required visible={visibleCredentials.clientId} onToggle={() => toggleCredential("clientId")} />
          <ZoomCredentialField name="clientSecret" label="Zoom Client Secret" description={status.provider?.hasClientSecret?'(saved; leave blank to keep)':undefined} required={!status.provider?.hasClientSecret} visible={visibleCredentials.clientSecret} onToggle={() => toggleCredential("clientSecret")} />
          <ZoomCredentialField name="webhookSecret" label="Webhook Secret" description={status.provider?.hasWebhookSecret?'(optional; saved; leave blank to keep)':'(optional)'} visible={visibleCredentials.webhookSecret} onToggle={() => toggleCredential("webhookSecret")} />
          {status.provider?.hasWebhookSecret?<label className="settings-zoom-card__checkbox"><input name="clearWebhookSecret" type="checkbox"/><Localized en={"Remove webhook secret"} zh={"移除 Webhook 密钥"} /></label>:null}
          <button className="btn-primary btn-primary--compact" disabled={busy} type="submit"><Localized en={"Save provider settings"} zh={"保存提供商设置"} /></button>
        </form>
        <p><Localized en={"Supabase redirect allow list:"} zh={"Supabase 重定向允许列表："} /><code>{appOrigin}/api/integrations/zoom/callback**</code></p>
        <p><Localized en={<>The Zoom app’s OAuth redirect remains your Supabase project’s <code>/auth/v1/callback</code>.</>} zh={<>Zoom 应用的 OAuth 重定向地址仍为 Supabase 项目的 <code>/auth/v1/callback</code>。</>} /></p>
        {status.provider?.webhookUrl?<p><Localized en={"Optional webhook URL:"} zh={"可选 Webhook 地址："} /><code>{status.provider.webhookUrl}</code></p>:null}
      </details>:null}
    </div>
  </section>;
}
