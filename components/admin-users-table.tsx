"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Coins, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

export type AdminUserRow = {
  adminDeletedAt: string | null;
  bedrockTokenLast4: string | null;
  bedrockTokenUpdatedAt: string | null;
  disabled: boolean;
  email: string | null;
  fullName: string | null;
  id: string;
  isAdmin: boolean;
  llmTokenQuota: number;
  llmTokenUsed: number;
  openclawInstance: string | null;
  openclawTokensPauseActorEmail: string | null;
  openclawTokensPauseReason: string | null;
  openclawTokensPaused: boolean;
  openclawTokensPausedAt: string | null;
  openclawTokensResumedAt: string | null;
  openclawProvisionStatus: string | null;
  projectCount: number;
};

type AdminUsersTableProps = {
  adminAvailableTokens: number;
  adminUserId: string;
  users: AdminUserRow[];
};

const PAGE_SIZE = 10;

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function describeUser(user: AdminUserRow) {
  return user.email ?? user.id;
}

function remainingCredits(user: AdminUserRow) {
  return Math.max(0, user.llmTokenQuota - user.llmTokenUsed);
}

function parseTransferAmount(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const amount = Number(text);

  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
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

export function AdminUsersTable({ adminAvailableTokens, adminUserId, users }: AdminUsersTableProps) {
  const router = useRouter();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<AdminUserRow | null>(null);
  const [pendingDrain, setPendingDrain] = useState<AdminUserRow | null>(null);
  const [dialogError, setDialogError] = useState("");

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return users;
    }

    return users.filter((user) =>
      [
        user.email,
        user.fullName,
        user.id,
        user.openclawInstance,
        user.openclawTokensPaused ? "paused" : "active",
        user.isAdmin ? "admin" : null
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [query, users]);

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  /** Resolves to an error message on failure, or null once the action succeeds. */
  async function runAction(userId: string, action: () => Promise<unknown>, successMessage = "Admin action completed.") {
    setBusyUserId(userId);
    setMessage(null);

    try {
      await action();
      router.refresh();
      setMessage(successMessage);
      return null;
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Admin action failed.";
      setMessage(failure);
      return failure;
    } finally {
      setBusyUserId(null);
    }
  }

  function openDialog(open: () => void) {
    setDialogError("");
    open();
  }

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }

    const failure = await runAction(
      pendingDelete.id,
      () => postJson(`/api/admin/users/${pendingDelete.id}/delete`, {}),
      `Deleted the account for ${describeUser(pendingDelete)}.`
    );

    if (failure) {
      setDialogError(failure);
      return;
    }

    setPendingDelete(null);
  }

  async function confirmDrain() {
    if (!pendingDrain) {
      return;
    }

    const drained = remainingCredits(pendingDrain);
    const failure = await runAction(
      pendingDrain.id,
      () => postJson(`/api/admin/users/${pendingDrain.id}/credits/drain`, {}),
      `Drained ${formatNumber(drained)} AI credits back to your account.`
    );

    if (failure) {
      setDialogError(failure);
      return;
    }

    setPendingDrain(null);
  }

  return (
    <section className="admin-table-shell" aria-labelledby="admin-users-title">
      <div className="projects-section__header">
        <h2 id="admin-users-title">AI CUBER users</h2>
        {message ? <p className="login-dialog__message" role="status">{message}</p> : null}
      </div>

      <div className="admin-users-toolbar">
        <label className="admin-users-toolbar__search">
          <Search aria-hidden="true" size={16} strokeWidth={1.8} />
          <input
            aria-label="Search users by email, name, or instance"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search by email, name, or instance..."
            type="search"
            value={query}
          />
        </label>
        <span className="admin-users-toolbar__count">
          {formatNumber(filteredUsers.length)} of {formatNumber(users.length)} users
        </span>
        <div className="admin-users-pagination">
          <button
            aria-label="Previous page"
            className="btn-ghost"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            type="button"
          >
            <ChevronLeft size={16} strokeWidth={1.8} />
          </button>
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <button
            aria-label="Next page"
            className="btn-ghost"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
            type="button"
          >
            <ChevronRight size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="admin-users-table">
        <div className="admin-users-table__head" role="row">
          <span>User</span>
          <span>Usage</span>
          <span>AI Agent</span>
          <span>Controls</span>
        </div>
        {pageUsers.length === 0 ? (
          <p className="admin-users-empty">No users match your search.</p>
        ) : null}
        {pageUsers.map((user) => {
          const remaining = remainingCredits(user);
          const isBusy = busyUserId === user.id;
          const isSelf = user.id === adminUserId;

          return (
            <article className="admin-user-row" key={user.id}>
              <div>
                <strong>{user.email ?? "No email"}</strong>
                <span>{user.fullName ?? user.id}</span>
                {user.isAdmin ? <span className="project-status project-status--running">admin</span> : null}
                <span className={`project-status${user.disabled ? " project-status--failed" : " project-status--ready"}`}>
                  {user.adminDeletedAt ? "deleted" : user.disabled ? "disabled" : "active"}
                </span>
              </div>

              <div>
                {user.isAdmin ? (
                  <>
                    <strong>Quota exempt</strong>
                    <span>Admin account</span>
                    <span>No AI credit quota required</span>
                  </>
                ) : (
                  <>
                    <strong>{formatNumber(remaining)} remaining</strong>
                    <span>{formatNumber(user.llmTokenUsed)} used</span>
                    <span>{formatNumber(user.llmTokenQuota)} assigned</span>
                  </>
                )}
              </div>

              <div>
                <strong>{user.openclawInstance ?? "No instance"}</strong>
                <span>{user.openclawProvisionStatus ?? "not provisioned"}</span>
                <span className={`project-status${user.openclawTokensPaused ? " project-status--failed" : " project-status--ready"}`}>
                  {user.openclawTokensPaused ? "AI paused" : "AI active"}
                </span>
                <span>Paused: {formatDateTime(user.openclawTokensPausedAt)}</span>
                <span>Resumed: {formatDateTime(user.openclawTokensResumedAt)}</span>
                {user.openclawTokensPaused ? (
                  <span>
                    Reason: {user.openclawTokensPauseReason ?? "paused"}
                    {user.openclawTokensPauseActorEmail ? ` by ${user.openclawTokensPauseActorEmail}` : ""}
                  </span>
                ) : null}
                <span>{user.projectCount} projects</span>
              </div>

              <div className="admin-user-row__controls">
                {user.isAdmin ? (
                  <span className="admin-field-hint">
                    Admin accounts are exempt from AI credit quotas, so no token quota is required.
                  </span>
                ) : (
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
                )}

                {user.isAdmin ? (
                  <span className="admin-field-hint">
                    Credit transfers are not required for admin accounts.
                  </span>
                ) : isSelf ? (
                  <span className="admin-field-hint">
                    This is your account. Use Settings to transfer your own AI credits.
                  </span>
                ) : user.email ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formElement = event.currentTarget;
                      const amount = parseTransferAmount(new FormData(formElement).get("transferAmount"));

                      if (!amount) {
                        setMessage("Enter a positive AI credit amount to send.");
                        return;
                      }

                      if (amount > adminAvailableTokens) {
                        setMessage("Transfer amount exceeds your available AI credits.");
                        return;
                      }

                      void runAction(
                        user.id,
                        () =>
                          postJson("/api/billing/credits/transfer", {
                            amountTokens: amount,
                            recipientEmail: user.email
                          }),
                        `Sent ${formatNumber(amount)} AI credits to ${user.email}.`
                      );
                      formElement.reset();
                    }}
                  >
                    <label htmlFor={`transfer-${user.id}`}>Send AI credits</label>
                    <input
                      disabled={isBusy || adminAvailableTokens <= 0}
                      id={`transfer-${user.id}`}
                      inputMode="numeric"
                      min={1}
                      max={adminAvailableTokens || undefined}
                      name="transferAmount"
                      placeholder={`Up to ${formatNumber(adminAvailableTokens)}`}
                      step={1}
                      type="number"
                    />
                    <button className="btn-ghost" disabled={isBusy || adminAvailableTokens <= 0} type="submit">
                      Send
                    </button>
                    {adminAvailableTokens <= 0 ? (
                      <span className="admin-field-hint">You have no available AI credits to send.</span>
                    ) : null}
                  </form>
                ) : (
                  <span className="admin-field-hint">No email on file; AI credits cannot be sent.</span>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const bearerToken = String(form.get("bearerToken") ?? "");
                    void runAction(user.id, () => postJson(`/api/admin/users/${user.id}/bedrock-token`, { bearerToken }));
                    event.currentTarget.reset();
                  }}
                >
                  <label htmlFor={`bedrock-${user.id}`}>AWS Bedrock bearer token</label>
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
                  {!user.openclawInstance ? (
                    <span className="admin-field-hint">
                      Disabled until this user has a provisioned AI Agent instance to install the token on.
                    </span>
                  ) : null}
                </form>

                <div className="admin-user-row__buttons">
                  {isSelf ? (
                    <span className="admin-field-hint">
                      Self access controls are locked so you cannot disable or delete your own admin account.
                    </span>
                  ) : (
                    <>
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
                      {!user.isAdmin ? (
                        <button
                          className="btn-ghost"
                          disabled={isBusy || remaining <= 0}
                          onClick={() => openDialog(() => setPendingDrain(user))}
                          title={remaining <= 0 ? "This user has no unused AI credits to drain." : "Drain unused AI credits to your admin account."}
                          type="button"
                        >
                          Drain credits
                        </button>
                      ) : null}
                      <button
                        className="btn-ghost danger-button"
                        disabled={isBusy}
                        onClick={() => openDialog(() => setPendingDelete(user))}
                        type="button"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <ConfirmDialog
        busy={busyUserId === pendingDelete?.id}
        busyLabel="Deleting..."
        closeLabel="Close delete user dialog"
        confirmLabel="Delete account"
        confirmWord="DELETE"
        description={
          <p>
            This deletes the account for <strong>{pendingDelete ? describeUser(pendingDelete) : ""}</strong>, tears down their AI
            Agent instance
            {pendingDelete?.openclawInstance ? <> (<strong>{pendingDelete.openclawInstance}</strong>)</> : null}, and erases their
            Nth Brains, wiki, and AI credits.
          </p>
        }
        error={dialogError}
        eyebrow="Delete account"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        open={pendingDelete !== null}
        title="Delete this account?"
        warning={
          <>
            This cannot be undone. {formatNumber(pendingDelete?.projectCount ?? 0)}{" "}
            {pendingDelete?.projectCount === 1 ? "Nth Brain project" : "Nth Brain projects"} will be destroyed. They can sign up
            again with the same Google account as a new user.
          </>
        }
      />

      <ConfirmDialog
        busy={busyUserId === pendingDrain?.id}
        busyLabel="Draining..."
        closeLabel="Close drain credits dialog"
        confirmIcon={<Coins size={17} strokeWidth={1.8} />}
        confirmLabel="Drain credits"
        description={
          <p>
            This moves <strong>{formatNumber(pendingDrain ? remainingCredits(pendingDrain) : 0)}</strong> unused AI credits from{" "}
            <strong>{pendingDrain ? describeUser(pendingDrain) : ""}</strong> back to your admin account.
          </p>
        }
        error={dialogError}
        eyebrow="Drain credits"
        onCancel={() => setPendingDrain(null)}
        onConfirm={() => void confirmDrain()}
        open={pendingDrain !== null}
        title="Drain unused credits?"
        warning="The user keeps credits they have already spent, but loses the unused balance immediately."
      />
    </section>
  );
}
