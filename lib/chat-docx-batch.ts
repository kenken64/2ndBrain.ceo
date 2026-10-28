import Docxtemplater from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module";
import PizZip from "pizzip";
import { checkOfficeArchive, type ChatAttachment } from "@/lib/chat-attachments";
import { prepareBatchData, type BatchData, type BatchMapping } from "@/lib/chat-pdf-batch";

function buildTemplate(bytes: Buffer, inspect: InspectModule) {
  return new Docxtemplater(new PizZip(bytes), {
    modules: [inspect],
    delimiters: { start: "{{", end: "}}" },
    linebreaks: true,
    // Resolve literal placeholder keys only; never evaluate template expressions.
    parser: tag => ({ get: (scope: Record<string, unknown>) => Object.hasOwn(scope, tag) ? scope[tag] : undefined })
  });
}

export async function prepareDocxBatch(file: ChatAttachment, spreadsheet: string): Promise<BatchData> {
  const format = file.type === "presentation" ? "PPTX" : "DOCX";
  await checkOfficeArchive(file.data, format);
  const inspect = new InspectModule();
  try { buildTemplate(file.data, inspect); }
  catch { throw new Error(`The ${format} template could not be read. Check that placeholders use matching {{ and }} braces.`); }
  const tags = inspect.getAllStructuredTags();
  if (tags.some(part => part.module || part.type !== "placeholder")) throw new Error("Use simple DOCX placeholders such as {{Name}}; loops, expressions and raw XML are not supported.");
  const names = [...new Set(tags.map(part => part.value))];
  if (!names.length) throw new Error(`The ${format} template has no placeholders. Add placeholders such as {{Name}}.`);
  if (names.length > 60) throw new Error("Use a DOCX template with at most 60 placeholders.");
  if (names.some(name => typeof name !== "string" || !/^[\p{L}\p{N}_ -]{1,100}$/u.test(name) || ["__proto__", "constructor", "prototype"].includes(name.toLowerCase()))) throw new Error("Use simple placeholder names containing letters, numbers, spaces, underscores or hyphens.");
  return prepareBatchData(names.map(name => ({ name, type: "text", required: true })), spreadsheet);
}

export function renderDocxRow(template: Buffer, data: BatchData, mapping: BatchMapping[], row: BatchData["rows"][number]): Buffer {
  const values: Record<string, string> = Object.create(null);
  for (const item of mapping) {
    if (item.column === null) continue;
    const value = row.values[data.headers.indexOf(item.column)];
    values[item.field] = value == null ? "" : String(value);
  }
  try {
    const doc = buildTemplate(template, new InspectModule());
    doc.render(values);
    return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    throw new Error(`Row ${row.number}: the document could not be generated. Check the template and values.`);
  }
}
