"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminUserRow = {
  adminDeletedAt: string | null;
  bedrockTokenLast4: string | null;
  bedrockTokenUpdatedAt: string | null;
  disabled: boolean;
  email: string | null;
  fullName: string | null;
  id: string;
  llmTokenQuota: number;
  llmTokenUsed: number;
  openclawInstance: string | null;
  openclawProvisionStatus: string | null;
  projectCount: number;
};

type AdminUsersTableProps = {
  users: AdminUserRow[];
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
  const data = (await response.json().catch(() => null)) as { error?: string; ok?: boolean } | null;

  if (!response.ok) {
    throw new Error(data?.error ?? "Admin request failed.");
  }

  return data;
}

export function AdminUsersTable({ users }: AdminUsersTableProps) {
  const router = useRouter();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function runAction(userId: string, action: () => Promise<unknown>) {
    setBusyUserId(userId);
    setMessage(null);

    try {
      await action();
      router.refresh();
      setMessage("Admin action completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin action failed.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section className="admin-table-shell" aria-labelledby="admin-users-title">
      <div className="projects-section__header">
        <h2 id="admin-users-title">Google users</h2>
        {message ? <p className="login-dialog__message" role="status">{message}</p> : null}
      </div>

      <div className="admin-users-table">
        <div className="admin-users-table__head" role="row">
          <span>User</span>
          <span>Usage</span>
          <span>AI Agent</span>
          <span>Controls</span>
        </div>
        {users.map((user) => {
          const remaining = Math.max(0, user.llmTokenQuota - user.llmTokenUsed);
          const isBusy = busyUserId === user.id;

          return (
            <article className="admin-user-row" key={user.id}>
              <div>
                <strong>{user.email ?? "No email"}</strong>
                <span>{user.fullName ?? user.id}</span>
                <span className={`project-status${user.disabled ? " project-status--failed" : " project-status--ready"}`}>
                  {user.adminDeletedAt ? "deleted" : user.disabled ? "disabled" : "active"}
                </span>
              </div>

              <div>
                <strong>{formatNumber(remaining)} remaining</strong>
                <span>{formatNumber(user.llmTokenUsed)} used</span>
                <span>{formatNumber(user.llmTokenQuota)} assigned</span>
              </div>

              <div>
                <strong>{user.openclawInstance ?? "No instance"}</strong>
                <span>{user.openclawProvisionStatus ?? "not provisioned"}</span>
                <span>{user.projectCount} projects</span>
              </div>

              <div className="admin-user-row__controls">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const quota = Number(form.get("quota") ?? 0);
                    void runAction(user.id, () => postJson(`/api/admin/users/${user.id}/quota`, { quota }));
                  }}
                >
                  <label htmlFor={`quota-${user.id}`}>Token quota</label>
                  <input
                    defaultValue={user.llmTokenQuota}
                    disabled={isBusy}
                    id={`quota-${user.id}`}
                    min={0}
                    name="quota"
                    step={1}
                    type="number"
                  />
                  <button className="btn-ghost" disabled={isBusy} type="submit">
                    Save
                  </button>
                </form>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const bearerToken = String(form.get("bearerToken") ?? "");
                    void runAction(user.id, () => postJson(`/api/admin/users/${user.id}/bedrock-token`, { bearerToken }));
                    event.currentTarget.reset();
                  }}
                >
                  <label htmlFor={`bedrock-${user.id}`}>Bedrock bearer token</label>
                  <input
                    autoComplete="off"
                    disabled={isBusy || !user.openclawInstance}
                    id={`bedrock-${user.id}`}
                    name="bearerToken"
                    placeholder={user.bedrockTokenLast4 ? `Last updated ...${user.bedrockTokenLast4}` : "Paste token"}
                    type="password"
                  />
                  <button className="btn-ghost" disabled={isBusy || !user.openclawInstance} type="submit">
                    Overwrite
                  </button>
                </form>

                <div className="admin-user-row__buttons">
                  <button
                    className="btn-ghost"
                    disabled={isBusy}
                    onClick={() =>
                      void runAction(user.id, () =>
                        postJson(`/api/admin/users/${user.id}/access`, { disabled: !user.disabled })
                      )
                    }
                    type="button"
                  >
                    {user.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    className="btn-ghost danger-button"
                    disabled={isBusy}
                    onClick={() => {
                      if (window.confirm(`Delete workspace data for ${user.email ?? user.id}?`)) {
                        void runAction(user.id, () => postJson(`/api/admin/users/${user.id}/delete`, {}));
                      }
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
