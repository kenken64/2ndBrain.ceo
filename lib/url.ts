import type { NextRequest } from "next/server";
import { getConfiguredSiteUrl, getSiteUrl } from "@/lib/env";

export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

export function getRequestOrigin(request: Request | NextRequest) {
  const configured = getConfiguredSiteUrl();
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "") ?? "http";

  if (configured) {
    return configured;
  }

  if (forwardedHost && isUsableHost(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  if (isUsableHost(requestUrl.host)) {
    return requestUrl.origin;
  }

  return getSiteUrl();
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
