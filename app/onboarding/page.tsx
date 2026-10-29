import { LanguageToggle, Localized, LocalizedContainer } from "@/components/language-provider";
import { redirect } from "next/navigation";
import { AgentSelectionForm } from "@/components/agent-selection-form";
import { Atmosphere } from "@/components/atmosphere";
import { AvaturnStep } from "@/components/avaturn-step";
import { BrandLogo } from "@/components/brand-logo";
import { EnrolmentForm } from "@/components/enrolment-form";
import { LoginDialog } from "@/components/login-dialog";
import { ProvisionForm } from "@/components/provision-form";
import { SetupCallout } from "@/components/setup-callout";
import { TelegramApprovalForm } from "@/components/telegram-approval-form";
import { hasSupabaseEnv, isWechatLoginEnabled } from "@/lib/env";
import {
  getRequiredOnboardingStep,
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  onboardingSteps,
  parseOnboardingStep,
  type OnboardingProfile,
  type OnboardingStep
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams: Promise<{
    next?: string;
    error?: string;
    step?: string;
  }>;
};

const errors: Record<string, string> = {
  avatar_download_failed: "AI Assistant export could not be downloaded. Export it again and retry.",
  avatar_download_not_glb: "The exported AI Assistant did not look like a GLB file. Export a GLB from Avaturn.",
  avatar_download_too_large: "The exported AI Assistant is too large to store locally.",
  avatar_upload_not_glb: "Upload a valid Avaturn GLB file.",
  avatar_upload_too_large: "The uploaded AI Assistant is too large to store locally.",
  invalid_avatar_url: "Avaturn did not return a valid secure GLB URL yet.",
  missing_avatar_storage_root: "AI Assistant storage is not configured on the server.",
  insufficient_ai_credits: "You need AI credits before provisioning AI Agent. Ask an admin to grant credits, then try again.",
  invalid_provision_target: "Select an agent to continue.",
  invalid_telegram_pair_code: "Enter the 8-character approval code from Telegram.",
  missing_avatar: "Create and export your Avaturn AI Assistant to continue.",
  missing_fields: "Add the required field to continue.",
  missing_aws_access_key_id: "Cloud access key is not configured on the server.",
  missing_aws_region: "Cloud region is not configured on the server.",
  missing_aws_secret_access_key: "Cloud secret access key is not configured on the server.",
  missing_openclaw_lightsail_snapshot_name: "AI Agent provisioning template is not configured.",
  missing_hermes_lightsail_snapshot_name: "The Hermes provisioning template is not configured.",
  missing_hermes_gyne_redis_url: "The Gyne connection is not configured on the server.",
  missing_openai_api_key: "OpenAI API key is not configured on the server.",
  openclaw_instance_not_found: "AI Agent provisioning completed but the instance name could not be detected.",
  openclaw_provision_failed: "AI Agent provisioning failed. Check AI credits first, then Cloud provisioning and clawmacdo output.",
  openclaw_provision_running: "AI Agent provisioning is already running. Please wait for the current request to finish.",
  openclaw_snapshot_not_found: "The configured AI Agent provisioning template could not be used. Check the Cloud region and server configuration.",
  openclaw_snapshot_response_failed: "AI Agent provisioning returned an unexpected response. Check the clawmacdo output and package version.",
  openclaw_telegram_pair_failed: "Telegram approval failed. Check the code from Telegram and try again.",
  openclaw_telegram_pair_required: "Provision AI Agent before approving the Telegram pairing code.",
  save_failed: "Profile setup could not be saved. Check that the onboarding migrations have run."
};

const stepMeta: Record<OnboardingStep, { index: number; kicker: string; title: string; copy: string }> = {
  enrolment: {
    index: 0,
    kicker: "Step 1 of 4",
    title: "Set up your AI CUBER profile",
    copy: "Provide the owner details, AI Assistant identity, and Telegram bot token to prepare your workspace for assistant creation."
  },
  avatar: {
    index: 1,
    kicker: "Step 2 of 4",
    title: "Create your Avaturn AI Assistant",
    copy: "Build your AI Assistant, export the GLB, and we will save it locally for the AI Agent upload."
  },
  agent: {
    index: 2,
    kicker: "Step 3 of 5",
    title: "Choose your agent",
    copy: "Pick the workspace agent you want to provision."
  },
  provision: {
    index: 3,
    kicker: "Step 4 of 5",
    title: "Provision your agent in the cloud",
    copy: "Prepare your agent, Telegram bot, and cloud workspace."
  },
  approval: {
    index: 4,
    kicker: "Step 5 of 5",
    title: "Approve Telegram pairing",
    copy: "Send your Telegram bot a message like “hi” — it replies with the approval code. Enter that code before generating your first workspace."
  }
};

const chineseStepMeta: Record<OnboardingStep, { title: string; copy: string }> = {
  enrolment: { title: "设置您的 AI CUBER 资料", copy: "填写所有者信息、AI 助手身份和 Telegram 机器人令牌，为创建助手准备工作空间。" },
  avatar: { title: "创建您的 Avaturn AI 助手", copy: "创建 AI 助手并导出 GLB 文件，我们会在本地保存以供 AI Agent 上传。" },
  agent: { title: "选择您的智能体", copy: "选择要配置的工作空间智能体。" },
  provision: { title: "在云端配置智能体", copy: "准备您的智能体、Telegram 机器人和云端工作空间。" },
  approval: { title: "批准 Telegram 配对", copy: "向 Telegram 机器人发送消息，例如“hi”，它会回复批准码。创建第一个工作空间前请输入该代码。" }
};
const chineseStepNames: Record<OnboardingStep, string> = { enrolment: "注册", avatar: "形象", agent: "智能体", provision: "配置", approval: "批准" };

function Stepper({ current }: { current: OnboardingStep }) {
  const currentIndex = stepMeta[current].index;

  return (
    <LocalizedContainer as="ol" labelEn="Setup progress" labelZh="设置进度" className="wizard-stepper">
      {onboardingSteps.map((step) => (
        <li className={stepMeta[step].index <= currentIndex ? "is-active" : ""} key={step}>
          <span>{stepMeta[step].index + 1}</span>
          <Localized en={step} zh={chineseStepNames[step]} />
        </li>
      ))}
    </LocalizedContainer>
  );
}

function ProgressBar({ current }: { current: OnboardingStep }) {
  const currentIndex = stepMeta[current].index;
  const progress = Math.round(((currentIndex + 1) / onboardingSteps.length) * 100);

  return (
    <div className="wizard-progress-wrap">
      <div className="wizard-progress__meta">
        <span><Localized en="Setup progress" zh="设置进度" /></span>
        <strong><Localized en={`${progress}% complete`} zh={`已完成 ${progress}%`} /></strong>
      </div>
      <LocalizedContainer
        as="div"
        labelEn={`Setup progress ${progress}%`}
        labelZh={`设置进度 ${progress}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="wizard-progress"
        role="progressbar"
      >
        <span style={{ width: `${progress}%` }} />
      </LocalizedContainer>
    </div>
  );
}

function EnrolmentStep({
  avatarGender,
  avatarName,
  errorMessage,
  next,
  ownerName
}: {
  avatarGender: string;
  avatarName: string;
  errorMessage: string | null;
  next: string;
  ownerName: string;
}) {
  return (
    <EnrolmentForm
      avatarGender={avatarGender}
      avatarName={avatarName}
      errorMessage={errorMessage}
      next={next}
      ownerName={ownerName}
    />
  );
}

function ProvisionStep({
  agentType,
  errorMessage,
  next,
  startedAt,
  status
}: {
  agentType?: string | null;
  errorMessage: string | null;
  next: string;
  startedAt?: string | null;
  status?: string | null;
}) {
  return <ProvisionForm agentType={agentType} errorMessage={errorMessage} next={next} startedAt={startedAt} status={status} />;
}

function AgentStep({
  errorMessage,
  next
}: {
  errorMessage: string | null;
  next: string;
}) {
  return <AgentSelectionForm errorMessage={errorMessage} next={next} />;
}

function ApprovalStep({
  errorMessage,
  next,
  status
}: {
  errorMessage: string | null;
  next: string;
  status?: string | null;
}) {
  return <TelegramApprovalForm errorMessage={errorMessage} next={next} status={status} />;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next ?? null, "/dashboard/chat");

  if (!hasSupabaseEnv()) {
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <SetupCallout />
        </main>
      </>
    );
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <div className="auth-stack">
            <LoginDialog next={onboardingPath(next)} supabaseConfigured={hasSupabaseEnv()} wechatEnabled={isWechatLoginEnabled()} />
          </div>
        </main>
      </>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(onboardingProfileSelect)
    .eq("id", userId)
    .maybeSingle();

  const onboardingProfile = profile as OnboardingProfile | null;

  if (isOnboardingComplete(onboardingProfile)) {
    redirect(next);
  }

  const requiredStep = getRequiredOnboardingStep(onboardingProfile) ?? "enrolment";
  const requestedStep = parseOnboardingStep(params.step);
  const currentStep = requestedStep ?? requiredStep;

  if (currentStep !== requiredStep) {
    redirect(onboardingPath(next, requiredStep));
  }

  const meta = stepMeta[currentStep];
  const errorMessage = params.error ? errors[params.error] ?? "Setup needs another try." : null;

  return (
    <>
      <Atmosphere />
      <main className="onboarding-page">
        <section className={`onboarding-card onboarding-card--${currentStep}`}>
          <LanguageToggle />
          <BrandLogo size={currentStep === "avatar" ? 88 : 120} />
          <Stepper current={currentStep} />
          <ProgressBar current={currentStep} />
          <p className="wizard-kicker"><Localized en={meta.kicker} zh={`第 ${meta.index + 1} 步，共 5 步`} /></p>
          <h1 className="onboarding-title"><Localized en={meta.title} zh={chineseStepMeta[currentStep].title} /></h1>
          <p className="onboarding-copy"><Localized en={meta.copy} zh={chineseStepMeta[currentStep].copy} /></p>

          {currentStep === "enrolment" ? (
            <EnrolmentStep
              avatarGender={onboardingProfile?.avatar_gender ?? ""}
              avatarName={onboardingProfile?.avatar_name ?? ""}
              errorMessage={errorMessage}
              next={next}
              ownerName={onboardingProfile?.owner_name ?? ""}
            />
          ) : null}

          {currentStep === "avatar" ? (
            <AvaturnStep errorMessage={errorMessage} next={next} />
          ) : null}

          {currentStep === "agent" ? (
            <AgentStep errorMessage={errorMessage} next={next} />
          ) : null}

          {currentStep === "provision" ? (
            <ProvisionStep
              agentType={onboardingProfile?.provision_target}
              errorMessage={errorMessage}
              next={next}
              startedAt={onboardingProfile?.openclaw_provision_started_at}
              status={onboardingProfile?.openclaw_provision_status}
            />
          ) : null}

          {currentStep === "approval" ? (
            <ApprovalStep
              errorMessage={errorMessage}
              next={next}
              status={onboardingProfile?.openclaw_telegram_pair_status}
            />
          ) : null}
        </section>
      </main>
    </>
  );
}
