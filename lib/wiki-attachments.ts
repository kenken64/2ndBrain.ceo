import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 80_000;

export type ConvertedWikiAttachment = {
  fileName: string;
  markdown: string;
  mimeType: string;
  path: string;
  size: number;
  sourceType: "docx" | "image" | "markdown" | "pdf" | "text";
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

async function convertFile(file: File, index: number): Promise<ConvertedWikiAttachment> {
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
      path: `raw/assets/${base}.md`,
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
      path: `raw/sources/${base}.md`,
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
      path: `raw/sources/${base}.md`,
      size: file.size,
      sourceType: "docx"
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
      path: `raw/sources/${base}.md`,
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
      path: `raw/sources/${base}.md`,
      size: file.size,
      sourceType: "text"
    };
  }

  throw new Error(`unsupported_attachment_type:${fileName}`);
}

export async function convertWikiAttachments(values: FormDataEntryValue[]) {
  const files = values.filter(isUploadedFile);

  if (files.length > MAX_ATTACHMENTS) {
    throw new Error("too_many_attachments");
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("attachments_too_large");
  }

  const converted: ConvertedWikiAttachment[] = [];

  for (const [index, file] of files.entries()) {
    converted.push(await convertFile(file, index));
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
