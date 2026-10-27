import { Coins, FileText, GitBranch, MessageSquare, Plug, Server, Store } from "lucide-react";
import { Atmosphere } from "@/components/atmosphere";
import { ChatInput } from "@/components/chat-input";
import { Footer } from "@/components/footer";
import { MarketingNav } from "@/components/marketing-nav";
import { Reveal } from "@/components/landing/reveal";
import { OperatingRoom } from "@/components/landing/operating-room";

const features = [
  { icon: MessageSquare, label: "AI 对话", title: "与不同 AI 模型对话", body: "选择 AI 模型，讨论问题并获得任务帮助。", href: "/dashboard/chat", action: "打开 AI 对话" },
  { icon: Coins, label: "按需付费", title: "按需充值 AI 积分", body: "充值 AI 积分、查看使用情况并掌握余额。目前使用 Solana 充值。", href: "/dashboard/settings?tab=payment", action: "管理 AI 积分" },
  { icon: Store, label: "工具市场", title: "找到合适的工具", body: "浏览并安装所需的工作流工具，为每个工具分配 AI 积分。", href: "/dashboard/marketplace", action: "探索工具市场" }
];
const steps = [
  { title: "使用 Google 登录", body: "登录您的账户，开始设置工作空间。" },
  { title: "设置身份", body: "填写您的姓名并设置虚拟形象。" },
  { title: "创建专属环境", body: "在云端创建您的 AI 助手运行环境。" },
  { title: "连接 Telegram", body: "通过 Telegram 审核需要您确认的操作。" },
  { title: "进入控制台", body: "使用知识库、知识图谱和 AI 助手。" }
];
const workspace = [
  { icon: FileText, title: "知识库", body: "根据需求和上传的资料创建项目，编辑、保存和导出 Markdown 文档。", href: "/dashboard/wiki", action: "打开知识库" },
  { icon: GitBranch, title: "知识图谱", body: "查看项目中页面与概念之间的联系，探索您的知识网络。", href: "/dashboard/graph", action: "打开知识图谱" },
  { icon: Server, title: "AI 助手工作空间", body: "查看助手运行状态并打开网关，管理您的专属环境。", href: "/dashboard/openclaw", action: "打开工作空间" }
];

export function ChineseLanding({ fontClass, supabaseConfigured }: { fontClass: string; supabaseConfigured: boolean }) {
  return (
    <div lang="zh-CN">
      <a className="skip-link" href="#main-content">跳至主要内容</a>
      <Atmosphere />
      <div className={`page-shell lp-type ${fontClass}`}>
        <MarketingNav locale="zh" supabaseConfigured={supabaseConfigured} />
        <main id="main-content">
          <section className="lp-hero">
            <div className="container lp-hero__grid">
              <div className="lp-hero__main">
                <p className="lp-hero__kicker">AI 助手 · 灵活积分 · 工作流工具</p>
                <h1 className="lp-hero__h1">
                  <span className="lp-hero__line"><span className="lp-hero__line-inner">您的 AI 工作空间。</span></span>
                  <span className="lp-hero__line"><span className="lp-hero__line-inner lp-hero__line-inner--2">随时为您<span className="lp-underline-wrap">准备就绪<svg aria-hidden="true" className="lp-underline" focusable="false" preserveAspectRatio="none" viewBox="0 0 300 14"><path d="M4 10 C 64 3, 152 13, 296 5" fill="none" pathLength={1} /></svg></span>。</span></span>
                </h1>
                <p className="lp-hero__sub">使用专属 AI 助手，按需充值积分，并在工具市场寻找合适的工作流。将知识保存在可编辑的知识库中，通过图谱探索内容之间的联系。</p>
                <ChatInput action="/intent" className="lp-hero-chat" locale="zh" method="get" placeholder="告诉助手您的项目需求，例如：创建一个管理供应商合同的知识库……" />
                <p className="lp-hero__caption">提交需求以创建知识库项目。您可以在下一步添加资料，并编辑或导出生成的文档。</p>
              </div>
            </div>
          </section>
          <section aria-labelledby="zh-features" className="lp-section lp-features" id="features">
            <div className="container">
              <Reveal as="header" className="lp-sec-head"><p className="lp-kicker">您的 AI 工作空间</p><h2 className="lp-h2" id="zh-features">需要时，找到合适的 AI 工具。</h2><p className="lp-lead">在一个工作空间中管理您的助手、AI 积分和工作流工具。</p></Reveal>
              <div className="lp-feature-grid">{features.map(({ icon: Icon, ...feature }, index) => <Reveal as="article" className="lp-feature-card" delay={index * 60} key={feature.label}><span aria-hidden="true" className="lp-feature-card__icon"><Icon size={22} /></span><span className="lp-feature-card__label">{feature.label}</span><h3>{feature.title}</h3><p>{feature.body}</p><a href={feature.href}>{feature.action} <span aria-hidden="true">→</span></a></Reveal>)}</div>
            </div>
          </section>
          <section aria-labelledby="zh-how" className="lp-section" id="how-it-works">
            <div className="container"><Reveal as="header" className="lp-sec-head"><p className="lp-kicker">工作原理</p><h2 className="lp-h2" id="zh-how">从一个想法，到属于您的知识库。</h2><p className="lp-lead">描述需求并添加资料，AI 助手会帮助您整理成可编辑的文档和知识图谱。敏感操作需要您的确认。</p></Reveal>
              <OperatingRoom locale="zh" />
            </div>
          </section>
          <section aria-labelledby="zh-setup" className="lp-section" id="setup"><div className="container"><Reveal as="header" className="lp-sec-head"><p className="lp-kicker">开始设置</p><h2 className="lp-h2" id="zh-setup">五步开启您的工作空间。</h2><p className="lp-lead">完成登录、身份设置和连接，开始使用您的专属助手。</p></Reveal><ol className="lp-zh-steps">{steps.map((step, index) => <li key={step.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol></div></section>
          <section aria-labelledby="zh-workspace" className="lp-section" id="workspace"><div className="container"><Reveal as="header" className="lp-sec-head"><p className="lp-kicker">工作空间</p><h2 className="lp-h2" id="zh-workspace">让知识和工具一起工作。</h2></Reveal><div className="lp-feature-grid">{workspace.map(({ icon: Icon, ...item }, index) => <Reveal as="article" className="lp-feature-card" delay={index * 60} key={item.title}><span aria-hidden="true" className="lp-feature-card__icon"><Icon size={22} /></span><h3>{item.title}</h3><p>{item.body}</p><a href={item.href}>{item.action} <span aria-hidden="true">→</span></a></Reveal>)}</div></div></section>
          <section aria-labelledby="zh-ownership" className="lp-section" id="ownership"><div className="container"><Reveal className="lp-start-card"><p className="lp-kicker">内容归您所有</p><h2 className="lp-h2" id="zh-ownership">您的知识，由您掌控。</h2><p className="lp-lead lp-zh-centered">您可以编辑和导出生成的 Markdown 页面，也可以删除项目。</p><div className="lp-start__actions"><a className="btn-primary" href="/intent">创建知识库 <span className="arrow">→</span></a><a className="btn-ghost" href="/onboarding">了解设置步骤</a></div></Reveal></div></section>
          <section aria-labelledby="zh-integrations" className="lp-section" id="integrations"><div className="container"><Reveal as="header" className="lp-sec-head"><p className="lp-kicker">应用连接</p><h2 className="lp-h2" id="zh-integrations">连接您使用的工具。</h2><p className="lp-lead">在工作空间中连接常用服务，完成登录、协作与积分充值。</p></Reveal><div className="lp-int-grid">{[{name:"Google Workspace",sub:"通过 Google 授权连接"},{name:"Telegram",sub:"配对与操作审核"},{name:"SSH 控制台",sub:"在控制台中访问"},{name:"Remotion 虚拟形象",sub:"为助手设置形象"},{name:"Google 登录",sub:"账户登录"},{name:"Solana",sub:"AI 积分充值"}].map((item) => <div className="lp-int-chip" key={item.name}><span aria-hidden="true" className="lp-int-chip__icon"><Plug size={18} /></span><span className="lp-int-chip__name">{item.name}</span><span className="lp-int-chip__sub">{item.sub}</span></div>)}</div></div></section>
          <section aria-labelledby="zh-start" className="lp-section" id="start"><div className="container"><Reveal className="lp-start-card"><p className="lp-kicker">开始使用</p><h2 className="lp-h2" id="zh-start">从您的想法开始。</h2><div className="lp-start__actions"><a className="btn-primary" href="/intent">创建项目 <span className="arrow">→</span></a><a className="btn-ghost" href="/onboarding">了解设置步骤</a></div><p className="lp-start__files">支持 PDF、DOCX、TXT、Markdown 和图片，最多 8 个文件，每个不超过 12 MB。</p></Reveal></div></section>
        </main>
        <Footer locale="zh" />
      </div>
    </div>
  );
}
