const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const filename = path.resolve(__dirname, '../lib/chat-attachments.ts');
const instance = new Module(filename, module); instance.filename = filename; instance.paths = module.paths;
const originalLoad = Module._load;
try { Module._load = function(request, ...args) { return request === '@/lib/chat-files-shared' ? { CHAT_FILE_MAX_BYTES: 20 * 1024 * 1024 } : originalLoad.call(this, request, ...args); }; instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename); }
finally { Module._load = originalLoad; }
const { parseChatAttachment, spreadsheetContext, spreadsheetPreview, documentText } = instance.exports;
const input = (name, data) => ({ name, data: Buffer.from(data).toString('base64') });
test('validates attachment content and computes complete spreadsheet statistics', async () => {
  assert.throws(() => parseChatAttachment(input('fake.pdf', 'not pdf')), /matching file type/);
  const max = Buffer.alloc(20 * 1024 * 1024, 65);
  assert.equal(parseChatAttachment(input('large.csv', max)).data.length, max.length);
  assert.throws(() => parseChatAttachment(input('large.csv', Buffer.alloc(max.length + 1, 65))), /20 MB/);
  const csv = parseChatAttachment(input('sales.csv', 'Region,Sales\nEast,10\nWest,30\n'));
  const summary = JSON.parse(await spreadsheetContext(csv));
  assert.equal(summary.sheets[0].rows.length, 3);
  assert.deepEqual(summary.sheets[0].numericColumnStatistics['2'], { count: 2, sum: 40, min: 10, max: 30 });
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Data');
  sheet.addRow(['Name', 'Amount']); sheet.addRow(['A', 5]); sheet.addRow(['B', 7]);
  const xlsx = parseChatAttachment(input('data.xlsx', await workbook.xlsx.writeBuffer()));
  const parsed = JSON.parse(await spreadsheetContext(xlsx));
  assert.equal(parsed.sheets[0].name, 'Data'); assert.equal(parsed.sheets[0].numericColumnStatistics['2'].sum, 12);
  sheet.getCell('B2').value = { formula: '1+1' };
  const formula = parseChatAttachment(input('formula.xlsx', await workbook.xlsx.writeBuffer()));
  await assert.rejects(spreadsheetContext(formula), /cached results/);
});

test('previews spreadsheet sheets and extracts DOCX text within archive limits', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Revenue'); sheet.addRow(['Region', 'Total']); sheet.addRow(['East', 42]);
  workbook.addWorksheet('Notes').addRow(['Second sheet']);
  const file = parseChatAttachment(input('data.xlsx', await workbook.xlsx.writeBuffer()));
  const preview = await spreadsheetPreview(file);
  assert.deepEqual(preview.sheets[0].rows[1], ['East', '42']);
  assert.equal(preview.sheets[1].name, 'Notes');
  sheet.getCell('A101').value = 'Outside preview';
  const limited = await spreadsheetPreview(parseChatAttachment(input('large.xlsx', await workbook.xlsx.writeBuffer())));
  assert.equal(limited.truncated, true); assert.equal(limited.sheets[0].rows.length, 100);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p></w:body></w:document>');
  const doc = parseChatAttachment(input('report.docx', await zip.generateAsync({ type: 'nodebuffer' })));
  assert.equal(doc.type, 'document'); assert.match(await documentText(doc), /Quarterly report/);
  const invalidZip = new JSZip(); invalidZip.file('wrong.txt', 'test');
  const invalid = parseChatAttachment(input('bad.docx', await invalidZip.generateAsync({ type: 'nodebuffer' })));
  await assert.rejects(documentText(invalid), /Invalid DOCX/);
});
