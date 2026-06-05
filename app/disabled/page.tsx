import { Atmosphere } from "@/components/atmosphere";

export default function DisabledAccountPage() {
  return (
    <>
      <Atmosphere />
      <main className="auth-page">
        <section className="auth-panel">
          <h1>Access disabled</h1>
          <p>Your 2ndBrain workspace access is currently disabled. Contact the workspace administrator if this is unexpected.</p>
          <div className="auth-actions">
            <a className="btn-primary" href="/auth/logout">
              Log out
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
