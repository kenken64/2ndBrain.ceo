import { Readable } from "node:stream";
import { fromBuffer } from "yauzl";

import { CHAT_FILE_MAX_BYTES } from "@/lib/chat-files-shared";
export { CHAT_FILE_MAX_BYTES } from "@/lib/chat-files-shared";
export type ChatAttachment = { name: string; type: "image" | "pdf" | "spreadsheet" | "document"; data: Buffer; mime: string };

export function validateChatFile(fileName: string, data: Buffer): ChatAttachment {
  if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 150 || !data.length || data.length > CHAT_FILE_MAX_BYTES) throw new Error("Choose a file between 1 byte and 20 MB, with a name under 150 characters.");
  const name = fileName.replace(/[\x00-\x1f]/g, "");
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf" && data.subarray(0, 5).toString() === "%PDF-") return { name, type: "pdf", data, mime: "application/pdf" };
  if ((ext === "png" && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || ((ext === "jpg" || ext === "jpeg") && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) || (ext === "webp" && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP")) return { name, type: "image", data, mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  if (ext === "xlsx" && data.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) return { name, type: "spreadsheet", data, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (ext === "docx" && data.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) return { name, type: "document", data, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  if (ext === "csv" && !data.includes(0)) return { name, type: "spreadsheet", data, mime: "text/csv" };
  throw new Error("Choose a PDF, PNG, JPEG, WebP, XLSX, CSV or DOCX file with a matching file type.");
}


export function parseChatAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.data !== "string" || item.data.length > Math.ceil(CHAT_FILE_MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error("Invalid attachment.");
  const data = Buffer.from(item.data, "base64");
  if (data.toString("base64") !== item.data) throw new Error("Invalid attachment.");
  return validateChatFile(item.name, data);
}

async function checkOfficeArchive(data: Buffer, type: "XLSX" | "DOCX") {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(data, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new Error(`Invalid ${type} file.`));
      let count = 0, expanded = 0, hasDocument = false;
      zip.on("error", () => reject(new Error(`Invalid ${type} file.`)));
      zip.on("entry", entry => {
        count++; expanded += entry.uncompressedSize;
        if (entry.fileName === (type === "DOCX" ? "word/document.xml" : "xl/workbook.xml")) hasDocument = true;
        if (count > 1000 || expanded > 25 * 1024 * 1024) { zip.close(); reject(new Error(`${type} file expands beyond the 25 MB limit.`)); return; }
        zip.readEntry();
      });
      zip.on("end", () => hasDocument ? resolve() : reject(new Error(`Invalid ${type} file.`)));
      zip.readEntry();
    });
  });
}

export async function spreadsheetContext(file: ChatAttachment): Promise<string> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (file.mime === "text/csv") await workbook.csv.read(Readable.from(file.data));
  else { await checkOfficeArchive(file.data, "XLSX"); await workbook.xlsx.load(file.data as never); }
  if (workbook.worksheets.length > 10) throw new Error("Use a workbook with at most 10 sheets.");
  const sheets: unknown[] = [];
  let cells = 0;
  for (const sheet of workbook.worksheets) {
    const rows: unknown[][] = [];
    const rowNumbers: number[] = [];
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
      rowNumbers.push(row.number);
    });
    sheets.push({ name: sheet.name, rows, rowNumbers, numericColumnStatistics: stats });
  }
  const result = JSON.stringify({ file: file.name, sheets });
  if (Buffer.byteLength(result) > 28_000) throw new Error("Spreadsheet data exceeds the chat analysis limit. Upload a smaller selection.");
  return result;
}

export async function documentText(file: ChatAttachment): Promise<string> {
  await checkOfficeArchive(file.data, "DOCX");
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: file.data });
  return result.value;
}

export async function spreadsheetPreview(file: ChatAttachment) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (file.mime === "text/csv") await workbook.csv.read(Readable.from(file.data));
  else { await checkOfficeArchive(file.data, "XLSX"); await workbook.xlsx.load(file.data as never); }
  let truncated = workbook.worksheets.length > 10;
  let remainingChars = 250_000;
  const sheets = workbook.worksheets.slice(0, 10).map(sheet => {
    const rowCount = Math.min(sheet.rowCount, 100), columnCount = Math.min(sheet.columnCount, 50);
    if (sheet.rowCount > rowCount || sheet.columnCount > columnCount) truncated = true;
    const rows: string[][] = [];
    for (let row = 1; row <= rowCount; row++) {
      const values: string[] = [];
      for (let column = 1; column <= columnCount; column++) {
        const value = sheet.getRow(row).getCell(column).text;
        const limit = Math.min(300, remainingChars);
        if (value.length > limit) truncated = true;
        const text = value.slice(0, limit);
        remainingChars -= text.length;
        values.push(text);
      }
      rows.push(values);
    }
    return { name: sheet.name, rows };
  });
  return { sheets, truncated };
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
