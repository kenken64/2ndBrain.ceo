type AnnouncementPillProps = {
  children: React.ReactNode;
};

export function AnnouncementPill({ children }: AnnouncementPillProps) {
  return (
    <a className="announcement-pill" href="/dashboard">
      <span className="announcement-pill__badge">New</span>
      <span>{children}</span>
      <span aria-hidden="true">-&gt;</span>
    </a>
  );
}
