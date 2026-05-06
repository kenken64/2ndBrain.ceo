import type { NextRequest } from "next/server";
import { getSiteUrl } from "@/lib/env";

export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

export function getRequestOrigin(request: Request | NextRequest) {
  const configured = getSiteUrl();
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  if (configured && configured !== "http://localhost:3000") {
    return configured;
  }

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return requestUrl.origin;
}
