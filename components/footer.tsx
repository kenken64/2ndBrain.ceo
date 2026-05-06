import { BrandHeart } from "@/components/brand-heart";

const columns = [
  {
    title: "Product",
    links: ["Builder", "Dashboard", "Templates", "Connectors"]
  },
  {
    title: "Resources",
    links: ["Guides", "Examples", "API status", "Security"]
  },
  {
    title: "Company",
    links: ["About", "Changelog", "Careers", "Contact"]
  },
  {
    title: "Legal",
    links: ["Privacy", "Terms", "DPA", "Cookies"]
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
              A calm AI workspace for founders who need their knowledge base to become an
              operating system.
            </p>
          </div>
          {columns.map((column) => (
            <div key={column.title}>
              <h4>{column.title}</h4>
              <ul>
                {column.links.map((link) => (
                  <li key={link}>
                    <a href="/dashboard">{link}</a>
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
