type AgentSelectionFormProps = {
  errorMessage: string | null;
  next: string;
};

export function AgentSelectionForm({ errorMessage, next }: AgentSelectionFormProps) {
  return (
    <form action="/api/onboarding" className="agent-select-form" method="post" noValidate>
      <input name="next" type="hidden" value={next} />
      <input name="step" type="hidden" value="agent" />
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      <div className="agent-select-grid" role="list">
        <button className="agent-option agent-option--active" name="provisionTarget" type="submit" value="openclaw">
          <span className="agent-option__media">
            <img alt="OpenClaw logo" src="/agent-logos/openclaw.png" />
          </span>
          <span className="agent-option__body">
            <strong>OpenClaw</strong>
            <span>Provision the OpenClaw workspace in the Cloud.</span>
          </span>
          <span className="agent-option__cta">Select OpenClaw -&gt;</span>
        </button>
        <button aria-disabled="true" className="agent-option agent-option--disabled" disabled type="button">
          <span className="agent-option__badge">Coming soon</span>
          <span className="agent-option__media">
            <img alt="HermesAgent logo" src="/agent-logos/hermes-agent.svg" />
          </span>
          <span className="agent-option__body">
            <strong>HermesAgent</strong>
            <span>HermesAgent provisioning will be available in a later release.</span>
          </span>
          <span className="agent-option__cta">Unavailable</span>
        </button>
      </div>
    </form>
  );
}
