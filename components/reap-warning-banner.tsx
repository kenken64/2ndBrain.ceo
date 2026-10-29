import { Localized } from "@/components/language-provider";
import { AlertTriangle } from "lucide-react";
import { REAPER_GRACE_DAYS } from "@/lib/instance-reaper-shared";

type ReapWarningBannerProps = {
  exhaustedAt: string;
  instance: string;
};

function formatRemaining(deadline: number, zh = false) {
  const msLeft = deadline - Date.now();

  if (msLeft <= 0) {
    return null;
  }

  const hours = Math.floor(msLeft / (60 * 60 * 1000));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return zh ? `${days} 天` : `${days} ${days === 1 ? "day" : "days"}`;
  }

  if (hours >= 1) {
    return zh ? `${hours} 小时` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return zh ? "不到一小时" : "less than an hour";
}

/**
 * Warns that an unfunded workspace is about to be reclaimed. Deleting the
 * instance is irreversible — it is not snapshotted, and re-provisioning starts
 * from the base image — so this is the only notice the user gets.
 */
export function ReapWarningBanner({ exhaustedAt, instance }: ReapWarningBannerProps) {
  const stamped = new Date(exhaustedAt).getTime();

  if (Number.isNaN(stamped)) {
    return null;
  }

  const remaining = formatRemaining(stamped + REAPER_GRACE_DAYS * 24 * 60 * 60 * 1000);

  return (
    <section className="reap-warning" role="alert">
      <div className="reap-warning__icon" aria-hidden="true">
        <AlertTriangle size={20} strokeWidth={1.9} />
      </div>
      <div className="reap-warning__body">
        <h2>
          {remaining ? <Localized en={`Your workspace will be deleted in ${remaining}`} zh={`您的工作空间将在 ${formatRemaining(stamped + REAPER_GRACE_DAYS * 24 * 60 * 60 * 1000, true)}后删除`} /> : <Localized en="Your workspace is being deleted" zh="您的工作空间正在删除" />}
        </h2>
        <p>
          <Localized en={<><strong>{instance}</strong> is running without AI credits. Add credits to keep it — otherwise it is torn down and its files cannot be recovered. Your wiki pages stay readable here, but anything only on the instance is lost.</>} zh={<><strong>{instance}</strong> 的 AI 积分已耗尽。请添加积分以保留实例，否则实例将被销毁，文件无法恢复。知识库页面仍可在此阅读，但仅保存在实例上的内容将丢失。</>} />
        </p>
      </div>
    </section>
  );
}
