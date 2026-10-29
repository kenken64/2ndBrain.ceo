import "server-only";
import { randomUUID } from "node:crypto";
import { validateChatFile, type ChatAttachment } from "@/lib/chat-attachments";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "aicuber-chat-uploads";
type Admin = ReturnType<typeof createAdminClient>;
type FileRow = { id: string; user_id: string; file_name: string; object_path: string; mime_type: string; size_bytes: number; created_at: string; file_origin: "upload" | "output"; source_file_id: string | null };
export function publicChatFile(row: FileRow) { return { id: row.id, name: row.file_name, mime: row.mime_type, size: row.size_bytes, createdAt: row.created_at, origin: row.file_origin }; }
async function saveFile(admin: Admin, userId: string, file: { name: string; data: Buffer; mime: string }, origin: "upload" | "output", sourceId: string | null) {
  const id = randomUUID();
  const path = `${userId}/${id}`;
  const bucket = admin.storage.from(BUCKET);
  const uploaded = await bucket.upload(path, file.data, { contentType: file.mime, upsert: false });
  if (uploaded.error) {
    console.error("[chat-files] Storage upload failed", { status: uploaded.error.statusCode ?? null, errorType: uploaded.error.name });
    throw new Error("File storage is unavailable. Please try again.");
  }
  const { data, error } = await admin.from("chat_files").insert({ id, user_id: userId, file_name: file.name, object_path: path, mime_type: file.mime, size_bytes: file.data.length, file_origin: origin, source_file_id: sourceId }).select("id,user_id,file_name,object_path,mime_type,size_bytes,created_at,file_origin,source_file_id").single();
  if (error || !data) {
    console.error("[chat-files] Metadata insert failed", { code: error?.code ?? null });
    const cleanup = await bucket.remove([path]);
    if (cleanup.error) console.error("[chat-files] Failed to clean up unregistered upload", id);
    throw new Error("File could not be saved. Please try again.");
  }
  return publicChatFile(data as FileRow);
}
export async function saveChatFile(admin: Admin, userId: string, file: ChatAttachment) {
  return saveFile(admin, userId, file, "upload", null);
}
export async function saveChatOutput(admin: Admin, userId: string, sourceId: string, sourceName: string, kind: "ocr" | "spreadsheet", content: string) {
  const safeBase = sourceName.replace(/\.[^.]+$/, "").slice(0, 110) || "chat";
  const name = `${safeBase}-${kind === "ocr" ? "ocr.md" : "analysis.json"}`;
  const data = Buffer.from(content, "utf8");
  if (!data.length || data.length > 20 * 1024 * 1024) throw new Error("Generated file is empty or too large.");
  return saveFile(admin, userId, { name, data, mime: kind === "ocr" ? "text/markdown" : "application/json" }, "output", sourceId);
}
export async function saveChatGeneratedPdf(admin: Admin, userId: string, sourceId: string, name: string, data: Buffer) {
  if (!data.length || data.length > 20 * 1024 * 1024 || data.subarray(0, 5).toString() !== "%PDF-") throw new Error("Generated PDF is invalid or exceeds 20 MB.");
  return saveFile(admin, userId, { name: name.slice(0, 150), data, mime: "application/pdf" }, "output", sourceId);
}
export async function saveChatGeneratedDocx(admin: Admin, userId: string, sourceId: string, name: string, data: Buffer) {
  if (!data.length || data.length > 20 * 1024 * 1024 || !data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error("Generated DOCX is invalid or exceeds 20 MB.");
  return saveFile(admin, userId, { name: name.slice(0, 150), data, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, "output", sourceId);
}
export async function saveChatGeneratedPptx(admin: Admin, userId: string, sourceId: string | null, name: string, data: Buffer) {
  if (!data.length || data.length > 20 * 1024 * 1024 || !data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error("Generated PPTX is invalid or exceeds 20 MB.");
  return saveFile(admin, userId, { name: name.slice(0, 150), data, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }, "output", sourceId);
}
export async function saveChatGeneratedImage(admin: Admin, userId: string, data: Buffer, mime: string) {
  const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const ext = extensions[mime];
  if (!ext || !data.length || data.length > 20 * 1024 * 1024) throw new Error("Generated image is invalid or exceeds 20 MB.");
  const name = `generated-image-${randomUUID().slice(0, 8)}.${ext}`;
  const validated = validateChatFile(name, data);
  if (validated.type !== "image" || validated.mime !== mime) throw new Error("Generated image has an invalid format.");
  return saveFile(admin, userId, { name, data, mime }, "output", null);
}
export async function saveChatGeneratedVideo(admin: Admin, userId: string, data: Buffer) {
  if (data.length < 12 || data.length > 20 * 1024 * 1024 || data.subarray(4, 8).toString() !== "ftyp") throw new Error("Generated video is invalid or exceeds 20 MB.");
  return saveFile(admin, userId, { name: `generated-video-${randomUUID().slice(0, 8)}.mp4`, data, mime: "video/mp4" }, "output", null);
}

export async function loadChatFile(admin: Admin, userId: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data: row, error } = await admin.from("chat_files").select("id,user_id,file_name,object_path,mime_type,size_bytes,created_at,file_origin,source_file_id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("File storage is unavailable.");
  if (!row) return null;
  const record = row as FileRow;
  if (record.object_path !== `${userId}/${record.id}`) throw new Error("Invalid file record.");
  const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(record.object_path);
  if (downloadError || !blob) throw new Error("The saved file is unavailable.");
  if (blob.size !== record.size_bytes) throw new Error("The saved file has an invalid size.");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const file = record.file_origin === "output"
    ? { name: record.file_name, data: bytes, mime: record.mime_type, type: "output" as const }
    : validateChatFile(record.file_name, bytes);
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const pptxMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const isImageOutput = file.type === "output" && ["image/png", "image/jpeg", "image/webp"].includes(file.mime);
  if (isImageOutput) {
    const validated = validateChatFile(file.name, bytes);
    if (validated.type !== "image" || validated.mime !== file.mime) throw new Error("The saved file has an invalid type.");
  }
  if (file.mime !== record.mime_type || (file.type === "output" && !isImageOutput && (!(["text/markdown", "application/json", "application/pdf", "video/mp4", docxMime, pptxMime].includes(file.mime)) || (file.mime === "video/mp4" && (bytes.length < 12 || bytes.subarray(4, 8).toString() !== "ftyp")) || (file.mime === "application/pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") || ((file.mime === docxMime || file.mime === pptxMime) && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))))) throw new Error("The saved file has an invalid type.");
  return { file, metadata: publicChatFile(record) };
}

// Storage objects do not follow the auth.users cascade. Remove them before deleting an account.
export async function deleteUserChatFiles(admin: Admin, userId: string) {
  while (true) {
    const { data, error } = await admin.from("chat_files").select("id,object_path").eq("user_id", userId).limit(100);
    if (error) throw new Error("Could not list saved chat files for account deletion.");
    if (!data?.length) return;
    if (data.some(row => row.object_path !== `${userId}/${row.id}`)) throw new Error("Invalid saved chat file path.");
    const removed = await admin.storage.from(BUCKET).remove(data.map(row => row.object_path));
    if (removed.error) throw new Error("Could not delete saved chat files.");
    const deleted = await admin.from("chat_files").delete().eq("user_id", userId).in("id", data.map(row => row.id));
    if (deleted.error) throw new Error("Could not remove saved chat file records.");
  }
}
