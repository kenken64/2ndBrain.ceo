const { createHmac, timingSafeEqual } = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Client: SshClient } = require("ssh2");
const { WebSocketServer } = require("ws");

const SSH_WS_PATH = "/api/openclaw/ssh";
const WS_OPEN = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 30 * 1000;
const DEFAULT_MAX_SESSIONS_PER_USER = 1;
const activeSessionsByUser = new Map();

function cleanEnv(value) {
  return value?.trim().replace(/^['"]|['"]$/g, "") || null;
}

function firstEnv(names) {
  for (const name of names) {
    const value = cleanEnv(process.env[name]);

    if (value) {
      return value;
    }
  }

  return null;
}

function optionalPositiveNumber(name, fallback) {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sshTokenSecret() {
  const secret = firstEnv([
    "OPENCLAW_SSH_TOKEN_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  ]);

  if (!secret) {
    throw new Error("SSH console token secret is not configured.");
  }

  return secret;
}

function signPayload(encodedPayload) {
  return createHmac("sha256", sshTokenSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySshToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("SSH console token is required.");
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature || !safeEqual(signature, signPayload(encodedPayload))) {
    throw new Error("SSH console token is invalid.");
  }

  let payload;

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("SSH console token could not be read.");
  }

  const exp = Number(payload.exp);
  const userId = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const instance = typeof payload.instance === "string" ? payload.instance.trim() : "";

  if (!userId || !instance || !Number.isFinite(exp)) {
    throw new Error("SSH console token is incomplete.");
  }

  if (Math.floor(Date.now() / 1000) > exp) {
    throw new Error("SSH console token expired. Reopen the console and try again.");
  }

  return {
    instance,
    userId
  };
}

function clawmacdoStateDir() {
  return (
    cleanEnv(process.env.CLAWMACDO_STATE_DIR) ||
    cleanEnv(process.env.RAILWAY_VOLUME_MOUNT_PATH) ||
    path.join(os.homedir(), ".clawmacdo")
  );
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function findStringValue(value, keys) {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const nested of Object.values(value)) {
    const match = findStringValue(nested, keys);

    if (match) {
      return match;
    }
  }

  return null;
}

function findPathLikeValue(value, matcher) {
  if (typeof value === "string") {
    return matcher(value) ? value.trim() : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const nested of Object.values(value)) {
    const match = findPathLikeValue(nested, matcher);

    if (match) {
      return match;
    }
  }

  return null;
}

function recordMatchesInstance(record, instance) {
  const normalized = instance.toLowerCase();
  const values = [
    record.id,
    record.hostname,
    record.host,
    record.instance,
    record.instance_name,
    record.instanceName,
    record.ip_address,
    record.ipAddress,
    record.public_ip,
    record.publicIp,
    record.publicIpAddress
  ];

  return values
    .filter((value) => typeof value === "string" && value.trim())
    .some((value) => value.trim().toLowerCase() === normalized);
}

async function readDeployRecord(instance) {
  const deploysDir = path.join(clawmacdoStateDir(), "deploys");
  let entries = [];

  try {
    entries = await fsp.readdir(deploysDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    try {
      const filePath = path.join(deploysDir, entry);
      const record = JSON.parse(await fsp.readFile(filePath, "utf8"));

      if (recordMatchesInstance(record, instance)) {
        return {
          filePath,
          record
        };
      }
    } catch {
      // Ignore malformed deploy records.
    }
  }

  return null;
}

async function existingFile(candidate) {
  if (!candidate) {
    return null;
  }

  try {
    const stat = await fsp.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function resolvePrivateKeyPath(deployRecord) {
  const stateDir = clawmacdoStateDir();
  const record = deployRecord.record;
  const direct = findStringValue(record, [
    "ssh_key",
    "sshKey",
    "ssh_key_path",
    "sshKeyPath",
    "private_key",
    "privateKey",
    "private_key_path",
    "privateKeyPath",
    "key_path",
    "keyPath"
  ]);
  const pathLike = findPathLikeValue(record, (value) => value.includes("/keys/") || value.includes(".clawmacdo/keys/"));
  const candidates = [direct, pathLike]
    .filter(Boolean)
    .flatMap((value) => [
      path.isAbsolute(value) ? value : path.join(stateDir, value),
      path.isAbsolute(value) ? value : path.join(path.dirname(deployRecord.filePath), value)
    ]);

  if (typeof record.id === "string" && record.id.trim()) {
    candidates.push(path.join(stateDir, "keys", `clawmacdo_${record.id.trim()}`));
  }

  if (typeof record.deploy_id === "string" && record.deploy_id.trim()) {
    candidates.push(path.join(stateDir, "keys", `clawmacdo_${record.deploy_id.trim()}`));
  }

  for (const candidate of candidates) {
    const match = await existingFile(candidate);

    if (match) {
      return match;
    }
  }

  throw new Error("SSH key for this OpenClaw instance was not found on the Railway volume.");
}

async function resolveSshTarget(instance) {
  const deployRecord = await readDeployRecord(instance);

  if (!deployRecord) {
    throw new Error("OpenClaw deploy record was not found on the Railway volume.");
  }

  const record = deployRecord.record;
  const host =
    findStringValue(record, [
      "ip_address",
      "ipAddress",
      "public_ip",
      "publicIp",
      "publicIpAddress",
      "host"
    ]) || (isIpAddress(instance) ? instance : null);
  const privateKeyPath = await resolvePrivateKeyPath(deployRecord);

  if (!host) {
    throw new Error("OpenClaw public IP is missing from the deploy record.");
  }

  return {
    host,
    privateKeyPath,
    username: cleanEnv(process.env.OPENCLAW_SSH_USER) || "openclaw"
  };
}

function sendJson(socket, payload) {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function incrementUserSession(userId) {
  const maxSessions = optionalPositiveNumber("OPENCLAW_SSH_MAX_SESSIONS_PER_USER", DEFAULT_MAX_SESSIONS_PER_USER);
  const current = activeSessionsByUser.get(userId) ?? 0;

  if (current >= maxSessions) {
    throw new Error("An SSH console is already open for this account.");
  }

  activeSessionsByUser.set(userId, current + 1);

  return () => {
    const next = Math.max(0, (activeSessionsByUser.get(userId) ?? 1) - 1);

    if (next === 0) {
      activeSessionsByUser.delete(userId);
    } else {
      activeSessionsByUser.set(userId, next);
    }
  };
}

function attachOpenClawSshServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");

    if (requestUrl.pathname !== SSH_WS_PATH) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
  });

  wss.on("connection", (socket) => {
    let authenticated = false;
    let releaseUserSession = null;
    let sshClient = null;
    let shellStream = null;
    let columns = 100;
    let rows = 32;
    const idleTimeoutMs = optionalPositiveNumber("OPENCLAW_SSH_IDLE_TIMEOUT_MS", DEFAULT_IDLE_TIMEOUT_MS);
    let idleTimer = null;

    function closeSession(code = 1000, reason = "closed") {
      clearTimeout(idleTimer);
      shellStream?.end();
      sshClient?.end();
      releaseUserSession?.();
      releaseUserSession = null;

      if (socket.readyState === WS_OPEN) {
        socket.close(code, reason);
      }
    }

    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        sendJson(socket, {
          message: "SSH console idle timeout reached.",
          type: "exit"
        });
        closeSession(1000, "idle timeout");
      }, idleTimeoutMs);
    }

    async function startSshSession(payload) {
      const auth = verifySshToken(payload.sshToken);
      releaseUserSession = incrementUserSession(auth.userId);
      const target = await resolveSshTarget(auth.instance);
      const privateKey = await fsp.readFile(target.privateKeyPath, "utf8");

      columns = Number.isFinite(Number(payload.cols)) ? Math.max(20, Number(payload.cols)) : columns;
      rows = Number.isFinite(Number(payload.rows)) ? Math.max(8, Number(payload.rows)) : rows;

      sendJson(socket, {
        host: target.host,
        message: `Connecting to ${auth.instance}...`,
        type: "status"
      });

      sshClient = new SshClient();
      sshClient.on("ready", () => {
        sshClient.shell(
          {
            cols: columns,
            rows,
            term: "xterm-256color"
          },
          (error, stream) => {
            if (error) {
              sendJson(socket, {
                message: error.message,
                type: "error"
              });
              closeSession(1011, "ssh shell failed");
              return;
            }

            shellStream = stream;
            authenticated = true;
            resetIdleTimer();
            sendJson(socket, {
              message: "SSH connected.",
              type: "ready"
            });

            stream.on("data", (data) => {
              sendJson(socket, {
                data: data.toString("utf8"),
                type: "data"
              });
            });
            stream.stderr.on("data", (data) => {
              sendJson(socket, {
                data: data.toString("utf8"),
                type: "data"
              });
            });
            stream.on("close", () => {
              sendJson(socket, {
                message: "SSH shell closed.",
                type: "exit"
              });
              closeSession(1000, "ssh shell closed");
            });
          }
        );
      });
      sshClient.on("error", (error) => {
        sendJson(socket, {
          message: error.message,
          type: "error"
        });
        closeSession(1011, "ssh error");
      });
      sshClient.on("close", () => {
        sendJson(socket, {
          message: "SSH connection closed.",
          type: "exit"
        });
        closeSession(1000, "ssh closed");
      });
      sshClient.connect({
        host: target.host,
        keepaliveInterval: optionalPositiveNumber("OPENCLAW_SSH_KEEPALIVE_INTERVAL_MS", 20 * 1000),
        passphrase: cleanEnv(process.env.OPENCLAW_SSH_KEY_PASSPHRASE) || undefined,
        port: optionalPositiveNumber("OPENCLAW_SSH_PORT", 22),
        privateKey,
        readyTimeout: optionalPositiveNumber("OPENCLAW_SSH_CONNECT_TIMEOUT_MS", DEFAULT_READY_TIMEOUT_MS),
        username: target.username
      });
    }

    socket.on("message", async (rawMessage) => {
      resetIdleTimer();

      let payload;

      try {
        payload = JSON.parse(rawMessage.toString("utf8"));
      } catch {
        sendJson(socket, {
          message: "Invalid SSH console message.",
          type: "error"
        });
        return;
      }

      try {
        if (payload.type === "auth") {
          if (authenticated || sshClient) {
            return;
          }

          await startSshSession(payload);
          return;
        }

        if (!authenticated || !shellStream) {
          return;
        }

        if (payload.type === "input" && typeof payload.data === "string") {
          shellStream.write(payload.data);
          return;
        }

        if (payload.type === "resize") {
          columns = Math.max(20, Number(payload.cols) || columns);
          rows = Math.max(8, Number(payload.rows) || rows);
          shellStream.setWindow(rows, columns, 0, 0);
        }
      } catch (error) {
        sendJson(socket, {
          message: error instanceof Error ? error.message : "SSH console failed.",
          type: "error"
        });
        closeSession(1011, "ssh setup failed");
      }
    });

    socket.on("close", () => {
      closeSession();
    });

    socket.on("error", () => {
      closeSession(1011, "websocket error");
    });

    resetIdleTimer();
    sendJson(socket, {
      message: "Authenticating SSH console...",
      type: "status"
    });
  });
}

module.exports = {
  attachOpenClawSshServer
};
