import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 80_000;
const execFileAsync = promisify(execFile);

export type ConvertedWikiAttachment = {
  fileName: string;
  markdown: string;
  mimeType: string;
  path: string;
  size: number;
  sourceType: "csv" | "doc" | "docx" | "image" | "markdown" | "pdf" | "spreadsheet" | "text";
};

type AttachmentConversionOptions = {
  assetRoot?: string;
  sourceRoot?: string;
};

function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "size" in value &&
    typeof value.size === "number" &&
    value.size > 0
  );
}

function sanitizeFileBase(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return cleaned || "attachment";
}

function extensionFromName(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function attachmentPath(root: string, base: string) {
  return `${root.replace(/^\/+|\/+$/g, "")}/${base}.md`;
}

function yamlString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function truncateExtractedText(value: string) {
  const normalized = value.trim().replace(/\r\n/g, "\n");

  if (normalized.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n\n[Content truncated after ${MAX_EXTRACTED_TEXT_CHARS} characters.]`;
}

function frontmatter(input: {
  fileName: string;
  mimeType: string;
  size: number;
  sourceType: ConvertedWikiAttachment["sourceType"];
}) {
  return [
    "---",
    `title: ${yamlString(`Attachment: ${input.fileName}`)}`,
    `type: ${yamlString("source")}`,
    "tags:",
    "  - attachment",
    `  - ${yamlString(input.sourceType)}`,
    `source_file: ${yamlString(input.fileName)}`,
    `mime_type: ${yamlString(input.mimeType || "application/octet-stream")}`,
    `byte_size: ${input.size}`,
    "---",
    ""
  ].join("\n");
}

function markdownFromText(input: {
  body: string;
  fileName: string;
  mimeType: string;
  size: number;
  sourceType: ConvertedWikiAttachment["sourceType"];
}) {
  return [
    frontmatter(input),
    `# Attachment: ${input.fileName}`,
    "",
    `Source type: ${input.sourceType.toUpperCase()}`,
    "",
    "## Extracted Markdown",
    "",
    truncateExtractedText(input.body) || "_No readable text was extracted._"
  ].join("\n");
}

async function convertPdf(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

async function convertDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

function extractBinaryText(buffer: Buffer) {
  const latinText = buffer
    .toString("latin1")
    .match(/[A-Za-z0-9 ,.;:'"!?()[\]{}@#$%&*+=/_\\|<>~`-]{4,}/g) ?? [];
  const utf16Text = buffer
    .toString("utf16le")
    .match(/[A-Za-z0-9 ,.;:'"!?()[\]{}@#$%&*+=/_\\|<>~`-]{4,}/g) ?? [];
  const seen = new Set<string>();

  return [...latinText, ...utf16Text]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4 && !seen.has(value) && seen.add(value))
    .join("\n");
}

function parseCsvRows(value: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let isQuoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (char === "\"" && isQuoted && next === "\"") {
      field += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      isQuoted = !isQuoted;
      continue;
    }

    if (char === "," && !isQuoted) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !isQuoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows.filter((csvRow) => csvRow.some(Boolean));
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function csvToMarkdown(value: string) {
  const rows = parseCsvRows(value).slice(0, 200);

  if (rows.length === 0) {
    return "";
  }

  const columnCount = Math.min(16, Math.max(...rows.map((row) => row.length)));
  const normalized = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => escapeMarkdownCell(row[index] ?? ""))
  );
  const [header, ...body] = normalized;
  const safeHeader = header.some(Boolean) ? header : header.map((_, index) => `Column ${index + 1}`);

  return [
    `| ${safeHeader.join(" | ")} |`,
    `| ${safeHeader.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function stripXml(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function columnIndexFromCellRef(cellRef: string) {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

async function readZipEntry(zipPath: string, entry: string) {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entry], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
    timeout: 60 * 1000
  });

  return stdout;
}

async function listZipEntries(zipPath: string) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 2,
    timeout: 60 * 1000
  });

  return stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

function parseSharedStrings(xml: string) {
  return (xml.match(/<si[\s\S]*?<\/si>/g) ?? []).map((item) => {
    const textNodes = item.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? [];
    return textNodes.length > 0 ? textNodes.map(stripXml).join("") : stripXml(item);
  });
}

function parseWorksheetMarkdown(xml: string, sharedStrings: string[]) {
  const rows = (xml.match(/<row[\s\S]*?<\/row>/g) ?? []).slice(0, 200);
  const parsedRows = rows.map((rowXml) => {
    const row: string[] = [];
    const cells = rowXml.match(/<c\b[\s\S]*?<\/c>/g) ?? [];

    for (const cell of cells) {
      const ref = cell.match(/\br="([^"]+)"/)?.[1] ?? "";
      const type = cell.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const value = cell.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const inline = cell.match(/<is[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? "";
      const columnIndex = ref ? columnIndexFromCellRef(ref) : row.length;
      const cellValue =
        type === "s"
          ? sharedStrings[Number(value)] ?? ""
          : type === "inlineStr"
            ? stripXml(inline)
            : decodeXml(value).trim();

      row[columnIndex] = cellValue;
    }

    return row;
  }).filter((row) => row.some(Boolean));

  return csvToMarkdown(parsedRows.map((row) => row.join(",")).join("\n"));
}

async function convertXlsx(buffer: Buffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wiki-xlsx-"));
  const filePath = path.join(tempDir, "workbook.xlsx");

  try {
    await fs.writeFile(filePath, buffer);

    const entries = await listZipEntries(filePath);
    const sharedStrings = entries.includes("xl/sharedStrings.xml")
      ? parseSharedStrings(await readZipEntry(filePath, "xl/sharedStrings.xml"))
      : [];
    const worksheets = entries
      .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const markdown: string[] = [];

    for (const [index, worksheet] of worksheets.entries()) {
      const table = parseWorksheetMarkdown(await readZipEntry(filePath, worksheet), sharedStrings);

      if (table) {
        markdown.push(`## Sheet ${index + 1}`, "", table);
      }
    }

    return markdown.join("\n\n");
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function convertFile(
  file: File,
  index: number,
  options: Required<AttachmentConversionOptions>
): Promise<ConvertedWikiAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment_too_large:${file.name}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileName = file.name || `attachment-${index + 1}`;
  const extension = extensionFromName(fileName);
  const mimeType = file.type || "application/octet-stream";
  const base = `${String(index + 1).padStart(2, "0")}-${sanitizeFileBase(fileName)}`;

  if (mimeType.startsWith("image/")) {
    const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
    return {
      fileName,
      markdown: [
        frontmatter({
          fileName,
          mimeType,
          size: file.size,
          sourceType: "image"
        }),
        `# Image Attachment: ${fileName}`,
        "",
        "This image was attached to the LLM wiki generation prompt.",
        "",
        `![${fileName}](${dataUri})`
      ].join("\n"),
      mimeType,
      path: attachmentPath(options.assetRoot, base),
      size: file.size,
      sourceType: "image"
    };
  }

  if (extension === "pdf" || mimeType === "application/pdf") {
    const text = await convertPdf(buffer);
    return {
      fileName,
      markdown: markdownFromText({
        body: text,
        fileName,
        mimeType,
        size: file.size,
        sourceType: "pdf"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "pdf"
    };
  }

  if (
    extension === "docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const text = await convertDocx(buffer);
    return {
      fileName,
      markdown: markdownFromText({
        body: text,
        fileName,
        mimeType,
        size: file.size,
        sourceType: "docx"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "docx"
    };
  }

  if (extension === "doc" || mimeType === "application/msword") {
    const text = extractBinaryText(buffer);
    return {
      fileName,
      markdown: markdownFromText({
        body: text,
        fileName,
        mimeType,
        size: file.size,
        sourceType: "doc"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "doc"
    };
  }

  if (extension === "csv" || mimeType === "text/csv") {
    const text = buffer.toString("utf8");
    const table = csvToMarkdown(text);
    return {
      fileName,
      markdown: markdownFromText({
        body: table || text,
        fileName,
        mimeType,
        size: file.size,
        sourceType: "csv"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "csv"
    };
  }

  if (
    extension === "xlsx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    const text = await convertXlsx(buffer).catch(() => extractBinaryText(buffer));
    return {
      fileName,
      markdown: markdownFromText({
        body: text,
        fileName,
        mimeType,
        size: file.size,
        sourceType: "spreadsheet"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "spreadsheet"
    };
  }

  if (extension === "xls" || mimeType === "application/vnd.ms-excel") {
    const text = extractBinaryText(buffer);
    return {
      fileName,
      markdown: markdownFromText({
        body: text,
        fileName,
        mimeType,
        size: file.size,
        sourceType: "spreadsheet"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "spreadsheet"
    };
  }

  if (extension === "md" || extension === "markdown" || mimeType === "text/markdown") {
    return {
      fileName,
      markdown: markdownFromText({
        body: buffer.toString("utf8"),
        fileName,
        mimeType,
        size: file.size,
        sourceType: "markdown"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "markdown"
    };
  }

  if (extension === "txt" || mimeType.startsWith("text/")) {
    return {
      fileName,
      markdown: markdownFromText({
        body: buffer.toString("utf8"),
        fileName,
        mimeType,
        size: file.size,
        sourceType: "text"
      }),
      mimeType,
      path: attachmentPath(options.sourceRoot, base),
      size: file.size,
      sourceType: "text"
    };
  }

  throw new Error(`unsupported_attachment_type:${fileName}`);
}

export async function convertWikiAttachments(
  values: FormDataEntryValue[],
  options: AttachmentConversionOptions = {}
) {
  const files = values.filter(isUploadedFile);
  const conversionOptions = {
    assetRoot: options.assetRoot ?? "raw/assets",
    sourceRoot: options.sourceRoot ?? "raw/sources"
  };

  if (files.length > MAX_ATTACHMENTS) {
    throw new Error("too_many_attachments");
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("attachments_too_large");
  }

  const converted: ConvertedWikiAttachment[] = [];

  for (const [index, file] of files.entries()) {
    converted.push(await convertFile(file, index, conversionOptions));
  }

  return converted;
}

export function buildAttachmentPromptContext(attachments: ConvertedWikiAttachment[]) {
  if (attachments.length === 0) {
    return "";
  }

  return [
    "Attached source files have been converted to markdown and written into the OpenClaw project before generation.",
    "Integrate these attachments into the wiki. Link image attachments from relevant generated markdown pages.",
    "",
    ...attachments.map(
      (attachment) =>
        `- ${attachment.path} (${attachment.sourceType}, original file: ${attachment.fileName}, ${attachment.size} bytes)`
    )
  ].join("\n");
}
