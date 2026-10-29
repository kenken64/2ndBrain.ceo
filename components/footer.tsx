"use client";

import { useLanguage } from "@/components/language-provider";
import { BrandLogo } from "@/components/brand-logo";

const columns = [
  {
    title: "Workspace",
    links: [
      ["Dashboard", "/dashboard"],
      ["LLM Wiki", "/dashboard/wiki"],
      ["Knowledge Graph", "/dashboard/graph"],
      ["AI Agent Gateway", "/dashboard/openclaw"]
    ]
  },
  {
    title: "Setup",
    links: [
      ["Onboarding", "/onboarding"],
      ["Login", "/login"],
      ["Start With Intent", "/intent"],
      ["Settings", "/dashboard/settings"]
    ]
  },
  {
    title: "Project",
    links: [
      ["Source Code", "https://github.com/kenken64/2ndBrain.ceo"],
      ["System Status", "/status"]
    ]
  }
];

const chineseColumns = [
  { title: "工作空间", links: [["控制台", "/dashboard"], ["知识库", "/dashboard/wiki"], ["知识图谱", "/dashboard/graph"], ["AI 助手", "/dashboard/openclaw"]] },
  { title: "开始使用", links: [["快速入门", "/onboarding"], ["登录", "/login"], ["创建项目", "/intent"], ["设置", "/dashboard/settings"]] },
  { title: "项目", links: [["源代码", "https://github.com/kenken64/2ndBrain.ceo"], ["系统状态", "/status"]] }
];

export function Footer({ locale }: { locale?: "en" | "zh" }) {
  const { language } = useLanguage();
  const chinese = (locale ?? language) === "zh";
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <a className="brand-link" href={chinese ? "/?lang=zh" : "/"}>
              <BrandLogo size={58} />
            </a>
            <p>
              {chinese
                ? "AI CUBER 工作空间：使用 AI 助手、创建知识库、编辑文档并探索知识图谱。"
                : "An educational front door for the AI CUBER workspace: onboarding, AI Agent, LLM Wiki projects, markdown editing, and knowledge graph exploration."}
            </p>
          </div>
          {(chinese ? chineseColumns : columns).map((column) => (
            <div key={column.title}>
              <h4>{column.title}</h4>
              <ul>
                {column.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href}>{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="footer__wordmark">
          AI CUBER
        </div>
      </div>
    </footer>
  );
}
