import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";

export async function zoomKey() {
  const configured = process.env.ZOOM_INTEGRATION_KEY?.trim();
  const root = process.env.INTEGRATIONS_STORAGE_ROOT?.trim() || "storage/integrations";
  const path = join(root, "zoom-token.key");
  let value = configured;
  if (!value) {
    if (!existsSync(path)) {
      const admin = createAdminClient();
      for (const table of ["zoom_provider_settings", "zoom_accounts", "zoom_link_attempts"]) {
        const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
        if (error || count) throw new Error("zoom_key_missing_or_storage_unavailable");
      }
      mkdirSync(root, { recursive: true });
      const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
      writeFileSync(temporary, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx", flush: true });
      try { try { linkSync(temporary, path); } catch (error: any) { if (error.code !== "EEXIST") throw error; } }
      finally { unlinkSync(temporary); }
    }
    value = readFileSync(path, "utf8").trim();
    chmodSync(path, 0o600);
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value,"base64url").length !== 32) throw new Error("zoom_key_invalid");
  return Buffer.from(value, "base64url");
}
export async function sealZoom(value: unknown, owner: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", await zoomKey(), iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, encrypted, cipher.getAuthTag()].map(v => v.toString("base64url")).join(".");
}
export async function unsealZoom<T>(value: string, owner: string): Promise<T> {
  const [iv, encrypted, tag] = value.split(".").map(v => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", await zoomKey(), iv);
  cipher.setAAD(Buffer.from(owner)); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(encrypted), cipher.final()]).toString());
}
