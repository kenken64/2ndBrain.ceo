export type BatchProgress = { total: number; processed: number; succeeded: number; failed: Array<{ row: number; error: string }> };
type FileRef = { id: string; name: string };
export async function readBatchProgress(response: Response, update: (progress: BatchProgress) => void) {
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "Could not start the batch.");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const files: FileRef[] = [], progress: BatchProgress = { total: 0, processed: 0, succeeded: 0, failed: [] };
  let buffer = "", complete = false;
  const parse = (line: string) => {
    if (!line) return;
    const event = JSON.parse(line) as { type: string; total?: number; row?: number; status?: string; error?: string; message?: string; file?: FileRef };
    if (event.type === "error") throw new Error(event.message || "The batch stopped unexpectedly.");
    if (event.type === "start" && typeof event.total === "number") progress.total = event.total;
    if (event.type === "row" && typeof event.row === "number") {
      progress.processed++;
      if (event.status === "succeeded" && event.file && typeof event.file.id === "string" && typeof event.file.name === "string") { files.push(event.file); progress.succeeded++; }
      else progress.failed.push({ row: event.row, error: event.error || "The row could not be generated." });
    }
    if (event.type === "done") complete = true;
    update({ ...progress, failed: [...progress.failed] });
  };
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length > 200_000) throw new Error("The batch response was too large.");
      const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; lines.forEach(parse);
    }
    buffer += decoder.decode(); if (buffer.trim()) parse(buffer);
  } catch (reason) {
    throw new Error(`${reason instanceof Error ? reason.message : "The batch was interrupted."} Check My files for any saved results before retrying.`);
  } finally { reader.releaseLock(); }
  if (!complete) throw new Error("The batch connection was interrupted. Check My files for saved results before retrying.");
  return { files, progress };
}
