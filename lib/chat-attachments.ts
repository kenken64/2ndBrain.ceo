import { Readable } from "node:stream";
import { fromBuffer } from "yauzl";

export const CHAT_FILE_MAX_BYTES = 2 * 1024 * 1024;
export type ChatAttachment = { name: string; type: "image" | "pdf" | "spreadsheet"; data: Buffer; mime: string };

export function parseChatAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || item.name.length < 1 || item.name.length > 150 || typeof item.data !== "string" || item.data.length > Math.ceil(CHAT_FILE_MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error("Invalid attachment.");
  const data = Buffer.from(item.data, "base64");
  if (!data.length || data.length > CHAT_FILE_MAX_BYTES || data.toString("base64") !== item.data) throw new Error("Attachment must be at most 2 MB.");
  const name = item.name.replace(/[\x00-\x1f]/g, "");
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf" && data.subarray(0, 5).toString() === "%PDF-") return { name, type: "pdf", data, mime: "application/pdf" };
  if ((ext === "png" && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || ((ext === "jpg" || ext === "jpeg") && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) || (ext === "webp" && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP")) return { name, type: "image", data, mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  if (ext === "xlsx" && data.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) return { name, type: "spreadsheet", data, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (ext === "csv" && !data.includes(0)) return { name, type: "spreadsheet", data, mime: "text/csv" };
  throw new Error("Choose a PDF, PNG, JPEG, WebP, XLSX or CSV file with a matching file type.");
}

async function checkXlsxArchive(data: Buffer) {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(data, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("Invalid XLSX file."));
      let count = 0, expanded = 0;
      zip.on("error", () => reject(new Error("Invalid XLSX file.")));
      zip.on("entry", entry => {
        count++; expanded += entry.uncompressedSize;
        if (count > 1000 || expanded > 25 * 1024 * 1024) { zip.close(); reject(new Error("Spreadsheet expands beyond the 25 MB limit.")); return; }
        zip.readEntry();
      });
      zip.on("end", () => resolve());
      zip.readEntry();
    });
  });
}

export async function spreadsheetContext(file: ChatAttachment): Promise<string> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (file.mime === "text/csv") await workbook.csv.read(Readable.from(file.data));
  else { await checkXlsxArchive(file.data); await workbook.xlsx.load(file.data as never); }
  if (workbook.worksheets.length > 10) throw new Error("Use a workbook with at most 10 sheets.");
  const sheets: unknown[] = [];
  let cells = 0;
  for (const sheet of workbook.worksheets) {
    const rows: unknown[][] = [];
    const stats: Record<number, { count: number; sum: number; min: number; max: number }> = {};
    if (sheet.rowCount > 5000 || sheet.columnCount > 100) throw new Error("Use at most 5,000 rows and 100 columns per sheet.");
    sheet.eachRow((row) => {
      const values: unknown[] = [];
      row.eachCell((cell, column) => {
        if (++cells > 100_000) throw new Error("Spreadsheet has too many populated cells.");
        let v: unknown = cell.value;
        if (v && typeof v === "object" && !(v instanceof Date)) {
          if ("formula" in v || "sharedFormula" in v) {
            if (!("result" in v) || v.result == null) throw new Error("Workbook has formulas without cached results. Recalculate and save it in Excel first.");
            v = v.result;
          } else if ("text" in v) v = v.text;
          else if ("richText" in v && Array.isArray(v.richText)) v = v.richText.map((part: { text?: string }) => part.text || "").join("");
          else v = String(cell.text);
        }
        if (v instanceof Date) v = v.toISOString();
        if (typeof v === "number" && Number.isFinite(v)) {
          const s = stats[column] ?? { count: 0, sum: 0, min: v, max: v };
          s.count++; s.sum += v; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); stats[column] = s;
        }
        values[column - 1] = v;
      });
      rows.push(values);
    });
    sheets.push({ name: sheet.name, rows, numericColumnStatistics: stats });
  }
  const result = JSON.stringify({ file: file.name, sheets });
  if (Buffer.byteLength(result) > 28_000) throw new Error("Spreadsheet data exceeds the chat analysis limit. Upload a smaller selection.");
  return result;
}

export async function pdfPageCount(file: ChatAttachment) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: file.data });
  try {
    const info = await parser.getInfo();
    if (!Number.isInteger(info.total) || info.total < 1 || info.total > 20) throw new Error("PDFs must contain 1–20 pages.");
    return info.total;
  } finally { await parser.destroy(); }
}
