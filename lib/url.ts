import type { NextRequest } from "next/server";
import { getConfiguredSiteUrls, getSiteUrl } from "@/lib/env";

export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

export function getIncomingRequestOrigin(request: Request | NextRequest) {
  const requestUrl = new URL(request.url);
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ??
    requestUrl.protocol.replace(":", "") ??
    "http";

  if (forwardedHost && isUsableHost(forwardedHost)) {
    const protocol = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "https";

    return `${protocol}://${forwardedHost}`;
  }

  if (isUsableHost(requestUrl.host)) {
    return requestUrl.origin;
  }

  return getSiteUrl();
}

export function getRequestOrigin(request: Request | NextRequest) {
  const configuredOrigins = getConfiguredSiteUrls();
  const incoming = getIncomingRequestOrigin(request);
  const canonicalOrigin = configuredOrigins.find((origin) => !isLocalOrigin(origin));

  if (isLocalOrigin(incoming) || !canonicalOrigin) {
    return incoming;
  }

  return canonicalOrigin;
}

export function appUrl(path: string, request: Request | NextRequest) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return new URL(path);
  }

  return new URL(path, getRequestOrigin(request));
}

function isUsableHost(host: string | null) {
  if (!host) {
    return false;
  }

  const normalized = host.trim().toLowerCase();

  return (
    Boolean(normalized) &&
    !normalized.startsWith("0.0.0.0") &&
    !normalized.startsWith("[::]") &&
    !normalized.startsWith("::")
  );
}

function firstHeaderValue(value: string | null) {
  return value
    ?.split(",")
    .map((part) => part.trim())
    .find(Boolean);
}

function isLocalOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin);

    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
