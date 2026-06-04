import { BrandHeart } from "@/components/brand-heart";

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
      ["Health Check", "/api/health"]
    ]
  }
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <a className="brand-link" href="/">
              <BrandHeart size={58} />
            </a>
            <p>
              An educational front door for the 2ndBrain workspace: onboarding, AI Agent,
              LLM Wiki projects, markdown editing, and knowledge graph exploration.
            </p>
          </div>
          {columns.map((column) => (
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
          2ndBrain
        </div>
      </div>
    </footer>
  );
}
