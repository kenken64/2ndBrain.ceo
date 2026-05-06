const templates = [
  {
    title: "Founder command center",
    description: "Track ideas, decisions, investor updates, and execution in one place."
  },
  {
    title: "Customer intelligence hub",
    description: "Turn calls, tickets, and research notes into a searchable product memory."
  },
  {
    title: "Operating cadence",
    description: "Generate weekly reviews, team rituals, and next actions from raw notes."
  }
];

export function TemplatesPanel() {
  return (
    <section aria-labelledby="templates-title" className="templates-panel" id="templates">
      <div className="templates-panel__header">
        <a className="btn-ghost" href="/dashboard">
          Templates
        </a>
        <a className="text-link" href="/dashboard">
          Browse all -&gt;
        </a>
      </div>
      <div className="templates-grid">
        {templates.map((template) => (
          <article className="template-card" key={template.title}>
            <div aria-hidden="true" className="template-card__thumb" />
            <div className="template-card__body">
              <h3>{template.title}</h3>
              <p>{template.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
