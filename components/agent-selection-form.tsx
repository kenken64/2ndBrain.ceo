import { Localized, LocalizedMessage } from "@/components/language-provider";
type AgentSelectionFormProps = {
  errorMessage: string | null;
  next: string;
};

export function AgentSelectionForm({ errorMessage, next }: AgentSelectionFormProps) {
  return (
    <form action="/api/onboarding" className="agent-select-form" method="post" noValidate>
      <input name="next" type="hidden" value={next} />
      <input name="step" type="hidden" value="agent" />
      {errorMessage ? <p className="form-error"><LocalizedMessage text={errorMessage} /></p> : null}
      <div className="agent-select-grid" role="list">
        <button className="agent-option agent-option--active" name="provisionTarget" type="submit" value="openclaw">
          <span className="agent-option__media">
            <img alt="" src="/agent-logos/openclaw.png" />
          </span>
          <span className="agent-option__body">
            <strong>{"OpenClaw"}</strong>
            <span><Localized en="Provision an OpenClaw workspace in the cloud." zh="在云端配置 OpenClaw 工作空间。" /></span>
          </span>
          <span className="agent-option__cta"><Localized en="Select OpenClaw →" zh="选择 OpenClaw →" /></span>
        </button>
        <button className="agent-option agent-option--active" name="provisionTarget" type="submit" value="hermes_agent">
          <span className="agent-option__media">
            <img alt="" src="/agent-logos/hermes-agent.svg" />
          </span>
          <span className="agent-option__body">
            <strong>HermesAgent</strong>
            <span><Localized en="Provision a Hermes Agent workspace in the cloud." zh="在云端配置 Hermes Agent 工作空间。" /></span>
          </span>
          <span className="agent-option__cta"><Localized en="Select Hermes Agent →" zh="选择 Hermes Agent →" /></span>
        </button>
      </div>
      <div className="provision-summary">
        <strong><Localized en="AI chat without a cloud agent" zh="不使用云端智能体的 AI 对话" /></strong>
        <span><Localized en="Use AI chat without provisioning a cloud server. Agent workspace, Nth Brain and Telegram require an agent." zh="无需配置云服务器即可使用 AI 对话。智能体工作空间、Nth Brain 和 Telegram 需要智能体。" /></span>
        <button className="btn-ghost" name="provisionTarget" type="submit" value="chat_only"><Localized en="Skip cloud setup and use AI chat" zh="跳过云端设置并使用 AI 对话" /></button>
      </div>
    </form>
  );
}
