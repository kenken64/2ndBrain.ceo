import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_GLB_BYTES = 50 * 1024 * 1024;
const STORAGE_ROOT = "storage/avatars";
const BLOCKED_HOSTS = new Set(["localhost", "0.0.0.0", "::1"]);

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

    return fetchDownload(nextUrl, redirectsRemaining - 1);
  }

  return response;
}

export async function downloadAvaturnGlb(avatarUrl: string, userId: string) {
  const parsedUrl = parseDownloadUrl(avatarUrl);

  if (!parsedUrl) {
    throw new Error("invalid_avatar_url");
  }

  const response = await fetchDownload(parsedUrl);

  if (!response.ok) {
    throw new Error("avatar_download_failed");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");

  if (contentLength > MAX_GLB_BYTES) {
    throw new Error("avatar_download_too_large");
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.byteLength > MAX_GLB_BYTES) {
    throw new Error("avatar_download_too_large");
  }

  if (buffer.subarray(0, 4).toString("utf8") !== "glTF") {
    throw new Error("avatar_download_not_glb");
  }

  const userDirectory = path.join(STORAGE_ROOT, safeSegment(userId));
  const fileName = `avaturn-${Date.now()}.glb`;
  const relativePath = path.join(userDirectory, fileName);
  const absolutePath = path.join(process.cwd(), relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    absolutePath,
    byteLength: buffer.byteLength,
    relativePath
  };
}
