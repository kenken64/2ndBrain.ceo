export default function Loading() {
  return <div className="page-progress page-progress--fallback" role="status" aria-live="polite"><span className="page-progress__track" aria-hidden="true" /><span className="page-progress__label">Loading page…</span></div>;
}
