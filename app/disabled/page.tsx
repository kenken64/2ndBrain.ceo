import { LanguageToggle, Localized } from "@/components/language-provider";
import { Atmosphere } from "@/components/atmosphere";

export default function DisabledAccountPage() {
  return (
    <>
      <Atmosphere />
      <main className="auth-page">
        <section className="auth-panel">
          <LanguageToggle />
          <h1><Localized en="Access disabled" zh="访问已停用" /></h1>
          <p><Localized en="Your AI CUBER workspace access is currently disabled. Contact the workspace administrator if this is unexpected." zh="您的 AI CUBER 工作空间访问权限已停用。如有疑问，请联系工作空间管理员。" /></p>
          <div className="auth-actions">
            <a className="btn-primary" href="/auth/logout">
              <Localized en="Log out" zh="退出登录" />
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
