"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


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

function formatDateTime(value: string | null, zh = false) {
  if (!value) {
    return zh ? "未记录" : "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return zh ? "未记录" : "Not recorded";
  }

  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en", {
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
  const _uiLanguage = useLanguage().language;
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
        <h2 id="admin-users-title"><Localized en={"AI CUBER users"} zh={"AI CUBER 用户"} /></h2>
        {message ? <p className="login-dialog__message" role="status"><LocalizedMessage text={message} /></p> : null}
      </div>

      <div className="admin-users-toolbar">
        <label className="admin-users-toolbar__search">
          <Search aria-hidden="true" size={16} strokeWidth={1.8} />
          <input
            aria-label={_uiLanguage === "zh" ? "按邮箱、姓名或实例搜索用户" : "Search users by email, name, or instance"}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={_uiLanguage === "zh" ? "按邮箱、姓名或实例搜索..." : "Search by email, name, or instance..."}
            type="search"
            value={query}
          />
        </label>
        <span className="admin-users-toolbar__count">
          {_uiLanguage === "zh" ? `${formatNumber(filteredUsers.length)} / ${formatNumber(users.length)} 位用户` : `${formatNumber(filteredUsers.length)} of ${formatNumber(users.length)} users`}
        </span>
        <div className="admin-users-pagination">
          <button
            aria-label={_uiLanguage === "zh" ? "上一页" : "Previous page"}
            className="btn-ghost"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            type="button"
          >
            <ChevronLeft size={16} strokeWidth={1.8} />
          </button>
          <span>
            {_uiLanguage === "zh" ? `第 ${currentPage} 页，共 ${pageCount} 页` : `Page ${currentPage} of ${pageCount}`}
          </span>
          <button
            aria-label={_uiLanguage === "zh" ? "下一页" : "Next page"}
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
          <span><Localized en={"User"} zh={"用户"} /></span>
          <span><Localized en={"Usage"} zh={"用量"} /></span>
          <span>AI Agent</span>
          <span><Localized en={"Controls"} zh={"控制"} /></span>
        </div>
        {pageUsers.length === 0 ? (
          <p className="admin-users-empty"><Localized en={"No users match your search."} zh={"没有符合搜索条件的用户。"} /></p>
        ) : null}
        {pageUsers.map((user) => {
          const remaining = remainingCredits(user);
          const isBusy = busyUserId === user.id;
          const isSelf = user.id === adminUserId;

          return (
            <article className="admin-user-row" key={user.id}>
              <div>
                <strong>{user.email ?? (_uiLanguage === "zh" ? "无邮箱" : "No email")}</strong>
                <span>{user.fullName ?? user.id}</span>
                {user.isAdmin ? <span className="project-status project-status--running"><Localized en={"admin"} zh={"管理员"} /></span> : null}
                <span className={`project-status${user.disabled ? " project-status--failed" : " project-status--ready"}`}>
                  {user.adminDeletedAt ? <Localized en={"deleted"} zh={"已删除"} /> : user.disabled ? <Localized en={"disabled"} zh={"已停用"} /> : <Localized en={"active"} zh={"运行中"} />}
                </span>
              </div>

              <div>
                {user.isAdmin ? (
                  <>
                    <strong><Localized en={"Quota exempt"} zh={"免配额"} /></strong>
                    <span><Localized en={"Admin account"} zh={"管理员账户"} /></span>
                    <span><Localized en={"No AI credit quota required"} zh={"无需 AI 积分配额"} /></span>
                  </>
                ) : (
                  <>
                    <strong>{_uiLanguage === "zh" ? `剩余 ${formatNumber(remaining)}` : `${formatNumber(remaining)} remaining`}</strong>
                    <span>{_uiLanguage === "zh" ? `已使用 ${formatNumber(user.llmTokenUsed)}` : `${formatNumber(user.llmTokenUsed)} used`}</span>
                    <span>{_uiLanguage === "zh" ? `已分配 ${formatNumber(user.llmTokenQuota)}` : `${formatNumber(user.llmTokenQuota)} assigned`}</span>
                  </>
                )}
              </div>

              <div>
                <strong>{user.openclawInstance ?? (_uiLanguage === "zh" ? "无实例" : "No instance")}</strong>
                <span><LocalizedMessage text={user.openclawProvisionStatus ?? "not provisioned"} /></span>
                <span className={`project-status${user.openclawTokensPaused ? " project-status--failed" : " project-status--ready"}`}>
                  {user.openclawTokensPaused ? <Localized en={"AI paused"} zh={"AI 已暂停"} /> : <Localized en={"AI active"} zh={"AI 运行中"} />}
                </span>
                <span>{_uiLanguage === "zh" ? "已暂停：" : "Paused: "}{formatDateTime(user.openclawTokensPausedAt, _uiLanguage === "zh")}</span>
                <span>{_uiLanguage === "zh" ? "已恢复：" : "Resumed: "}{formatDateTime(user.openclawTokensResumedAt, _uiLanguage === "zh")}</span>
                {user.openclawTokensPaused ? (
                  <span>
                    {_uiLanguage === "zh" ? "原因：" : "Reason: "}{user.openclawTokensPauseReason ?? (_uiLanguage === "zh" ? "已暂停" : "paused")}
                    {user.openclawTokensPauseActorEmail ? ` by ${user.openclawTokensPauseActorEmail}` : ""}
                  </span>
                ) : null}
                <span>{_uiLanguage === "zh" ? `${user.projectCount} 个项目` : `${user.projectCount} projects`}</span>
              </div>

              <div className="admin-user-row__controls">
                {user.isAdmin ? (
                  <span className="admin-field-hint">
                    <Localized en={"Admin accounts are exempt from AI credit quotas, so no token quota is required."} zh={"管理员账户不受 AI 积分配额限制，因此无需 Token 配额。"} /></span>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const quota = Number(form.get("quota") ?? 0);
                      void runAction(user.id, () => postJson(`/api/admin/users/${user.id}/quota`, { quota }));
                    }}
                  >
                    <label htmlFor={`quota-${user.id}`}><Localized en={"Token quota"} zh={"Token 配额"} /></label>
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
                      <Localized en={"Save"} zh={"保存"} /></button>
                  </form>
                )}

                {user.isAdmin ? (
                  <span className="admin-field-hint">
                    <Localized en={"Credit transfers are not required for admin accounts."} zh={"管理员账户无需转移积分。"} /></span>
                ) : isSelf ? (
                  <span className="admin-field-hint">
                    <Localized en={"This is your account. Use Settings to transfer your own AI credits."} zh={"这是您的账户。请在设置中转移自己的 AI 积分。"} /></span>
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
                    <label htmlFor={`transfer-${user.id}`}><Localized en={"Send AI credits"} zh={"发送 AI 积分"} /></label>
                    <input
                      disabled={isBusy || adminAvailableTokens <= 0}
                      id={`transfer-${user.id}`}
                      inputMode="numeric"
                      min={1}
                      max={adminAvailableTokens || undefined}
                      name="transferAmount"
                      placeholder={_uiLanguage === "zh" ? `最多 ${formatNumber(adminAvailableTokens)}` : `Up to ${formatNumber(adminAvailableTokens)}`}
                      step={1}
                      type="number"
                    />
                    <button className="btn-ghost" disabled={isBusy || adminAvailableTokens <= 0} type="submit">
                      <Localized en={"Send"} zh={"发送"} /></button>
                    {adminAvailableTokens <= 0 ? (
                      <span className="admin-field-hint"><Localized en={"You have no available AI credits to send."} zh={"您没有可发送的 AI 积分。"} /></span>
                    ) : null}
                  </form>
                ) : (
                  <span className="admin-field-hint"><Localized en={"No email on file; AI credits cannot be sent."} zh={"未记录电子邮箱，无法发送 AI 积分。"} /></span>
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
                  <label htmlFor={`bedrock-${user.id}`}><Localized en={"AWS Bedrock bearer token"} zh={"AWS Bedrock 访问令牌"} /></label>
                  <input
                    autoComplete="off"
                    disabled={isBusy || !user.openclawInstance}
                    id={`bedrock-${user.id}`}
                    name="bearerToken"
                    placeholder={user.bedrockTokenLast4 ? (_uiLanguage === "zh" ? `上次更新 ...${user.bedrockTokenLast4}` : `Last updated ...${user.bedrockTokenLast4}`) : (_uiLanguage === "zh" ? "粘贴令牌" : "Paste token")}
                    type="password"
                  />
                  <button className="btn-ghost" disabled={isBusy || !user.openclawInstance} type="submit">
                    <Localized en={"Overwrite"} zh={"覆盖"} /></button>
                  {!user.openclawInstance ? (
                    <span className="admin-field-hint">
                      <Localized en={"Disabled until this user has a provisioned AI Agent instance to install the token on."} zh={"此用户配置 AI Agent 实例以安装令牌后才能使用。"} /></span>
                  ) : null}
                </form>

                <div className="admin-user-row__buttons">
                  {isSelf ? (
                    <span className="admin-field-hint">
                      <Localized en={"Self access controls are locked so you cannot disable or delete your own admin account."} zh={"自身访问控制已锁定，因此您不能停用或删除自己的管理员账户。"} /></span>
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
                        {user.disabled ? <Localized en={"Enable"} zh={"启用"} /> : <Localized en={"Disable"} zh={"停用"} />}
                      </button>
                      {!user.isAdmin ? (
                        <button
                          className="btn-ghost"
                          disabled={isBusy || remaining <= 0}
                          onClick={() => openDialog(() => setPendingDrain(user))}
                          title={_uiLanguage === "zh" ? (remaining <= 0 ? "此用户没有可收回的未使用 AI 积分。" : "将未使用的 AI 积分收回到您的管理员账户。") : (remaining <= 0 ? "This user has no unused AI credits to drain." : "Drain unused AI credits to your admin account.")}
                          type="button"
                        >
                          <Localized en={"Drain credits"} zh={"收回积分"} /></button>
                      ) : null}
                      <button
                        className="btn-ghost danger-button"
                        disabled={isBusy}
                        onClick={() => openDialog(() => setPendingDelete(user))}
                        type="button"
                      >
                        <Localized en={"Delete"} zh={"删除"} /></button>
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
            <Localized en={<>This deletes the account for <strong>{pendingDelete ? describeUser(pendingDelete) : ""}</strong>, tears down their AI Agent instance {pendingDelete?.openclawInstance ? <> (<strong>{pendingDelete.openclawInstance}</strong>)</> : null}, and erases their Nth Brains, wiki, and AI credits.</>} zh={<>这将删除 <strong>{pendingDelete ? describeUser(pendingDelete) : ""}</strong> 的账户、销毁其 AI Agent 实例{pendingDelete?.openclawInstance ? <>（<strong>{pendingDelete.openclawInstance}</strong>）</> : null}，并清除其 Nth Brain、知识库和 AI 积分。</>} />
          </p>
        }
        error={dialogError}
        eyebrow="Delete account"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        open={pendingDelete !== null}
        title={_uiLanguage === "zh" ? "删除此账户？" : "Delete this account?"}
        warning={
          <>
            <Localized en={`This cannot be undone. ${formatNumber(pendingDelete?.projectCount ?? 0)} Nth Brain project${pendingDelete?.projectCount === 1 ? "" : "s"} will be destroyed. They can sign up again with the same Google account as a new user.`} zh={`此操作无法撤销。将销毁 ${formatNumber(pendingDelete?.projectCount ?? 0)} 个 Nth Brain 项目。此用户可以使用同一 Google 账户重新注册为新用户。`} />
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
            <Localized en={<>This moves <strong>{formatNumber(pendingDrain ? remainingCredits(pendingDrain) : 0)}</strong> unused AI credits from <strong>{pendingDrain ? describeUser(pendingDrain) : ""}</strong> back to your admin account.</>} zh={<>这将从 <strong>{pendingDrain ? describeUser(pendingDrain) : ""}</strong> 收回 <strong>{formatNumber(pendingDrain ? remainingCredits(pendingDrain) : 0)}</strong> 个未使用的 AI 积分至您的管理员账户。</>} />
          </p>
        }
        error={dialogError}
        eyebrow="Drain credits"
        onCancel={() => setPendingDrain(null)}
        onConfirm={() => void confirmDrain()}
        open={pendingDrain !== null}
        title={_uiLanguage === "zh" ? "收回未使用的积分？" : "Drain unused credits?"}
        warning="The user keeps credits they have already spent, but loses the unused balance immediately."
      />
    </section>
  );
}
