import { AlertTriangle } from "lucide-react";
import { REAPER_GRACE_DAYS } from "@/lib/instance-reaper-shared";

type ReapWarningBannerProps = {
  exhaustedAt: string;
  instance: string;
};

function formatRemaining(deadline: number) {
  const msLeft = deadline - Date.now();

  if (msLeft <= 0) {
    return null;
  }

  const hours = Math.floor(msLeft / (60 * 60 * 1000));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }

  if (hours >= 1) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return "less than an hour";
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
          {remaining
            ? `Your workspace will be deleted in ${remaining}`
            : "Your workspace is being deleted"}
        </h2>
        <p>
          <strong>{instance}</strong> is running without AI credits. Add credits to keep it — otherwise it is torn down and
          its files cannot be recovered. Your wiki pages stay readable here, but anything only on the instance is lost.
        </p>
      </div>
    </section>
  );
}
