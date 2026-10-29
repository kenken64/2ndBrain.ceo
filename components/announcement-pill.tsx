import { Localized } from "@/components/language-provider";
type AnnouncementPillProps = {
  children: React.ReactNode;
};

export function AnnouncementPill({ children }: AnnouncementPillProps) {
  return (
    <a className="announcement-pill" href="/dashboard">
      <span className="announcement-pill__badge"><Localized en="New" zh="新" /></span>
      <span className="announcement-pill__text">{children}</span>
      <span aria-hidden="true">-&gt;</span>
    </a>
  );
}
