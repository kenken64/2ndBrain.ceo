import { ArrowRight, BookOpenText, ClipboardList, Gamepad2, ListTodo, Newspaper, Smartphone, Timer, type LucideIcon } from "lucide-react";
import { translateUiMessage } from "@/lib/ui-messages";
import { MARKETPLACE_ITEMS } from "@/lib/workflow-templates";

const icons: Record<string, LucideIcon> = {
  "2d-game-dev-tutorial": Gamepad2,
  "gyne-agent": ListTodo,
  "psle-eng-tutor-brain": BookOpenText,
  "news-intelligence-desk": Newspaper,
  "meeting-minutes": ClipboardList,
  "mobile-device-operator": Smartphone,
  "pomodoro-timer": Timer
};

export function MarketplaceShowcase({ locale = "en" }: { locale?: "en" | "zh" }) {
  const zh = locale === "zh";
  const translate = (text: string) => translateUiMessage(text, locale);

  return (
    <section aria-labelledby="marketplace-heading" className="lp-section lp-marketplace" id="marketplace">
      <div className="container">
        <header className="lp-marketplace__header">
          <div className="lp-sec-head">
            <p className="lp-kicker">{zh ? "工具市场" : "MARKETPLACE"}</p>
            <h2 className="lp-h2" id="marketplace-heading">{zh ? "为您的工作找到合适的工具。" : "Tools for the work you do."}</h2>
            <p className="lp-lead">{zh ? "探索可在工作空间中安装的工具。从游戏开发到会议纪要，选择适合您的工具。" : "Explore tools for your workspace, from game development and learning to meetings and automation."}</p>
          </div>
          <a className="btn-ghost lp-marketplace__browse" href="/dashboard/marketplace">
            {zh ? "查看工具市场" : "Browse marketplace"} <ArrowRight aria-hidden="true" size={17} />
          </a>
        </header>

        <div className="lp-marketplace__grid">
          {MARKETPLACE_ITEMS.map((item) => {
            const Icon = icons[item.id] ?? ListTodo;

            return (
              <article className="lp-marketplace-card" key={item.id}>
                <div className="lp-marketplace-card__top">
                  <span aria-hidden="true" className="lp-marketplace-card__icon"><Icon size={21} strokeWidth={1.8} /></span>
                  <span className="lp-marketplace-card__category">{translate(item.category)}</span>
                </div>
                <h3>{translate(item.title)}</h3>
                <p className="lp-marketplace-card__description">{translate(item.description)}</p>
                <ul className="lp-marketplace-card__steps">
                  {item.steps.map((step) => <li key={step}>{translate(step)}</li>)}
                </ul>
                <div className="lp-marketplace-card__footer">
                  <span className="lp-marketplace-card__price">
                    {item.priceTokens === 0 ? <strong>{zh ? "免费" : "Free"}</strong> : <>{zh ? "标价 " : "Listed price "}<strong>{new Intl.NumberFormat("en-US").format(item.priceTokens)}</strong> {zh ? "AI 积分" : "AI credits"}</>}
                  </span>
                  {item.repoUrl ? <a aria-label={`${zh ? "在 GitHub 查看" : "View on GitHub"}: ${translate(item.title)}`} href={item.repoUrl} rel="noreferrer" target="_blank">GitHub <span aria-hidden="true">↗</span></a> : <a href="/dashboard/marketplace">{zh ? "安装应用" : "Install app"} <span aria-hidden="true">→</span></a>}
                </div>
              </article>
            );
          })}
        </div>
        <p className="lp-marketplace__note">{zh ? "管理员账户可免费安装。登录后可在工具市场查看您的安装和积分使用情况。" : "Admin installs are free. Sign in to view your installations and credit usage in the marketplace."}</p>
      </div>
    </section>
  );
}
