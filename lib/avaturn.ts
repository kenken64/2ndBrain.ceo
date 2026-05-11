import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_GLB_BYTES = 50 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "0.0.0.0", "::1"]);

type StoredAvatar = {
  absolutePath: string;
  byteLength: number;
  relativePath: string;
};

type UploadedGlb = {
  arrayBuffer(): Promise<ArrayBuffer>;
  name?: string;
  size: number;
};

function getStorageRoot() {
  const configuredRoot = process.env.AVATAR_STORAGE_ROOT?.trim();

  if (!configuredRoot) {
    throw new Error("missing_avatar_storage_root");
  }

  return configuredRoot;
}

function isBlockedHost(hostname: string) {
  const normalized = hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(normalized)) {
    return true;
  }

  if (
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("169.254.")
  ) {
    return true;
  }

  const [first, second] = normalized.split(".").map((part) => Number(part));
  return first === 172 && second >= 16 && second <= 31;
}

function parseDownloadUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || isBlockedHost(url.hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function avatarDebugEnabled() {
  return ["1", "true", "yes"].includes(process.env.AVATURN_DEBUG?.trim().toLowerCase() ?? "");
}

function redactUrl(url: URL) {
  return `${url.origin}${url.pathname}`;
}

function redactUserId(userId: string) {
  const safeUserId = safeSegment(userId);

  if (safeUserId.length <= 10) {
    return safeUserId;
  }

  return `${safeUserId.slice(0, 4)}...${safeUserId.slice(-4)}`;
}

function avatarDebug(
  event: string,
  details: Record<string, boolean | number | string | null | undefined>
) {
  if (!avatarDebugEnabled()) {
    return;
  }

  console.info(`[avaturn] ${event}`, JSON.stringify(details));
}

function assertGlbBuffer(buffer: Buffer, tooLargeCode: string, notGlbCode: string) {
  if (buffer.byteLength > MAX_GLB_BYTES) {
    throw new Error(tooLargeCode);
  }

  if (buffer.subarray(0, 4).toString("utf8") !== "glTF") {
    throw new Error(notGlbCode);
  }
}

async function storeAvatarBuffer(buffer: Buffer, userId: string): Promise<StoredAvatar> {
  const safeUserId = safeSegment(userId);
  const userDirectory = path.join(getStorageRoot(), safeUserId);
  const fileName = `${safeUserId}_avatar.glb`;
  const relativePath = path.join(userDirectory, fileName);
  const absolutePath = path.join(/* turbopackIgnore: true */ process.cwd(), relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    absolutePath,
    byteLength: buffer.byteLength,
    relativePath
  };
}

async function fetchDownload(url: URL, redirectsRemaining = 4): Promise<Response> {
  const response = await fetch(url, {
    redirect: "manual"
  });

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has("location") &&
    redirectsRemaining > 0
  ) {
    const nextUrl = parseDownloadUrl(new URL(response.headers.get("location") ?? "", url).toString());

    if (!nextUrl) {
      throw new Error("invalid_avatar_url");
    }

    avatarDebug("download:redirect", {
      from: redactUrl(url),
      redirectsRemaining,
      to: redactUrl(nextUrl)
    });

    return fetchDownload(nextUrl, redirectsRemaining - 1);
  }

  return response;
}

export async function downloadAvaturnGlb(avatarUrl: string, userId: string) {
  const parsedUrl = parseDownloadUrl(avatarUrl);

  if (!parsedUrl) {
    avatarDebug("download:error", {
      code: "invalid_avatar_url",
      userId: redactUserId(userId)
    });
    throw new Error("invalid_avatar_url");
  }

  avatarDebug("download:start", {
    url: redactUrl(parsedUrl),
    userId: redactUserId(userId)
  });

  const response = await fetchDownload(parsedUrl);
  const contentLengthHeader = response.headers.get("content-length");
  const contentType = response.headers.get("content-type");

  avatarDebug("download:response", {
    contentLength: contentLengthHeader,
    contentType,
    ok: response.ok,
    status: response.status,
    url: redactUrl(parsedUrl),
    userId: redactUserId(userId)
  });

  if (!response.ok) {
    avatarDebug("download:error", {
      code: "avatar_download_failed",
      status: response.status,
      userId: redactUserId(userId)
    });
    throw new Error("avatar_download_failed");
  }

  const contentLength = Number(contentLengthHeader ?? "0");

  if (contentLength > MAX_GLB_BYTES) {
    avatarDebug("download:error", {
      byteLength: contentLength,
      code: "avatar_download_too_large",
      userId: redactUserId(userId)
    });
    throw new Error("avatar_download_too_large");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const magic = buffer.subarray(0, 4).toString("utf8");
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  avatarDebug("download:buffer", {
    byteLength: buffer.byteLength,
    magic,
    sha256Prefix: sha256.slice(0, 16),
    userId: redactUserId(userId)
  });

  assertGlbBuffer(buffer, "avatar_download_too_large", "avatar_download_not_glb");

  const storedAvatar = await storeAvatarBuffer(buffer, userId);

  avatarDebug("download:stored", {
    byteLength: storedAvatar.byteLength,
    relativePath: storedAvatar.relativePath,
    userId: redactUserId(userId)
  });

  return storedAvatar;
}

export async function storeUploadedAvaturnGlb(uploadedFile: UploadedGlb, userId: string) {
  if (!uploadedFile.name?.toLowerCase().endsWith(".glb")) {
    throw new Error("avatar_upload_not_glb");
  }

  if (uploadedFile.size <= 0) {
    throw new Error("missing_avatar");
  }

  if (uploadedFile.size > MAX_GLB_BYTES) {
    throw new Error("avatar_upload_too_large");
  }

  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  assertGlbBuffer(buffer, "avatar_upload_too_large", "avatar_upload_not_glb");

  return storeAvatarBuffer(buffer, userId);
}
