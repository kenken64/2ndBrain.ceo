import { PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFTextField } from "pdf-lib";

export type BatchField = { name: string; type: "text" | "checkbox" | "dropdown"; options?: string[]; required: boolean };
export type BatchData = { fields: BatchField[]; headers: string[]; rows: Array<{ number: number; values: unknown[] }> };
export type BatchMapping = { field: string; column: string | null };
const MAX_ROWS = 100;
const MAX_FIELDS = 60;

export async function preparePdfBatch(pdf: Buffer, spreadsheet: string): Promise<BatchData> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  if (doc.getPageCount() > 20) throw new Error("Use a PDF template with at most 20 pages.");
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm?.has(PDFName.of("XFA"))) throw new Error("This PDF uses XFA fields, which are not supported. Export it as a standard fillable PDF.");
  const form = doc.getForm();
  const fields = form.getFields().map(field => {
    if (field instanceof PDFTextField) return { name: field.getName(), type: "text" as const, required: field.isRequired() };
    if (field instanceof PDFCheckBox) return { name: field.getName(), type: "checkbox" as const, required: field.isRequired() };
    if (field instanceof PDFDropdown) return { name: field.getName(), type: "dropdown" as const, options: field.getOptions(), required: field.isRequired() };
    throw new Error(`The PDF field “${field.getName()}” is not a supported text field, checkbox or dropdown.`);
  });
  if (!fields.length) throw new Error("The PDF has no fillable form fields. Use a fillable PDF template.");
  if (fields.length > MAX_FIELDS) throw new Error(`Use a PDF template with at most ${MAX_FIELDS} fields.`);
  if (fields.some(field => field.name.length > 200 || field.options?.some(option => option.length > 200))) throw new Error("PDF field names and options must be at most 200 characters.");
  const parsed = JSON.parse(spreadsheet) as { sheets?: Array<{ name: string; rows: unknown[][]; rowNumbers?: number[] }> };
  const sheet = parsed.sheets?.[0];
  if (!sheet?.rows?.length) throw new Error("The first spreadsheet sheet is empty.");
  const headers = Array.from(sheet.rows[0], value => value == null ? "" : String(value).trim());
  if (!headers.length || headers.some(value => !value || value.length > 200) || new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new Error("The first row must contain unique, non-empty column names, each under 200 characters.");
  const rows = sheet.rows.slice(1).map((values, index) => ({ number: sheet.rowNumbers?.[index + 1] ?? index + 2, values })).filter(row => row.values.some(value => value != null && String(value).trim() !== ""));
  if (!rows.length) throw new Error("Add at least one record below the spreadsheet headers.");
  if (rows.length > MAX_ROWS) throw new Error(`Generate at most ${MAX_ROWS} PDFs at a time. Split the spreadsheet into smaller batches.`);
  return { fields, headers, rows };
}

export function validateBatchMapping(value: unknown, data: BatchData): BatchMapping[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { mappings?: unknown }).mappings)) throw new Error("The AI could not determine the field mapping. Describe the columns and try again.");
  const mappings = (value as { mappings: unknown[] }).mappings;
  const byName = new Map<string, string | null>();
  for (const item of mappings) {
    if (!item || typeof item !== "object") throw new Error("Invalid field mapping.");
    const { field, column } = item as Record<string, unknown>;
    if (typeof field !== "string" || (column !== null && typeof column !== "string") || !data.fields.some(f => f.name === field) || (column !== null && !data.headers.includes(column)) || byName.has(field)) throw new Error("The AI returned an invalid field mapping. Describe the columns and try again.");
    byName.set(field, column as string | null);
  }
  const missing = data.fields.filter(field => !byName.has(field.name) || byName.get(field.name) === null);
  if (missing.length) throw new Error(`These PDF fields could not be mapped: ${missing.map(field => field.name).join(", ")}. Describe the corresponding spreadsheet columns and try again.`);
  return data.fields.map(field => ({ field: field.name, column: byName.get(field.name)! }));
}

export async function renderPdfRow(template: Buffer, data: BatchData, mapping: BatchMapping[], row: BatchData["rows"][number]): Promise<Buffer> {
  const doc = await PDFDocument.load(template, { updateMetadata: false });
  const form = doc.getForm();
  for (const item of mapping) {
    if (item.column === null) continue;
    const field = form.getField(item.field);
    const raw = row.values[data.headers.indexOf(item.column)];
    const text = raw == null ? "" : String(raw);
    if (field.isRequired() && !text.trim()) throw new Error(`Row ${row.number}: required column “${item.column}” is empty.`);
    if (field instanceof PDFTextField) {
      const limit = field.getMaxLength();
      if (limit !== undefined && text.length > limit) throw new Error(`Row ${row.number}: “${item.column}” exceeds the PDF field's ${limit}-character limit.`);
      field.setText(text);
    } else if (field instanceof PDFCheckBox) {
      const value = text.trim().toLowerCase();
      if (["yes", "true", "1", "y", "on"].includes(value)) field.check();
      else if (["no", "false", "0", "n", "off", ""].includes(value)) field.uncheck();
      else throw new Error(`Row ${row.number}: “${item.column}” must contain yes/no or true/false for a checkbox.`);
    } else if (field instanceof PDFDropdown) {
      if (!text && !field.isRequired()) field.clear();
      else if (field.getOptions().includes(text)) field.select(text);
      else throw new Error(`Row ${row.number}: “${item.column}” does not match a dropdown option.`);
    }
  }
  try { return Buffer.from(await doc.save()); }
  catch { throw new Error(`Row ${row.number}: the PDF renderer could not render one or more characters or field values. Non-Latin characters may not be supported.`); }
}
