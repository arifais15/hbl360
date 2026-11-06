const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx');
const {
  buildTemplateWorkbook,
  readWorkbookRows
} = require('../services/excelImportService');
const {
  employeeImportFields,
  employeeTemplateOptions,
  loanImportFields,
  loanTemplateOptions
} = require('../services/importTemplateDefinitions');

const employeeFields = [
  { key: 'emp_code', label: 'পে আইডি', required: true, description: 'কর্মচারীর পে আইডি।' },
  { key: 'name', label: 'পূর্ণ নাম', required: true, description: 'কর্মচারীর নাম।' }
];

test('branded employee template keeps canonical headers and imports its example sheet safely', async () => {
  const workbook = buildTemplateWorkbook(employeeFields, {
    title: 'কর্মচারী আমদানি',
    subtitle: 'কর্মচারী তথ্য',
    examples: [{ emp_code: '0001', name: 'উদাহরণ কর্মচারী' }]
  });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = readWorkbookRows(buffer, ['emp_code', 'name']);
  const writtenWorkbook = XLSX.read(buffer, { type: 'buffer' });
  const inputSheet = writtenWorkbook.Sheets.Import;

  assert.deepEqual(parsed, []);
  assert.equal(writtenWorkbook.SheetNames[0], 'Import');
  assert.equal(inputSheet.A4.v, 'emp_code');
  assert.equal(inputSheet.B4.v, 'name');
  assert.equal(workbook.getWorksheet('Import').views[0].ySplit, 4);
  assert.equal(workbook.getWorksheet('Import').getCell('A4').font.bold, true);
  assert.equal(workbook.getWorksheet('উদাহরণ (আপলোড নয়)').getCell('A4').value, '0001');
});

test('import parser still accepts legacy templates with headers on the first row', () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['emp_code', 'name'],
    ['0002', 'পুরোনো টেমপ্লেট']
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Import');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  assert.deepEqual(readWorkbookRows(buffer, ['emp_code', 'name']), [{
    rowNumber: 2,
    values: { emp_code: '0002', name: 'পুরোনো টেমপ্লেট' }
  }]);
});

test('import parser locates template headers below title rows', () => {
  const workbook = buildTemplateWorkbook(employeeFields, {
    title: 'কর্মচারী আমদানি',
    subtitle: 'কর্মচারী তথ্য',
    examples: [{ emp_code: '0001', name: 'উদাহরণ কর্মচারী' }]
  });
  const sheet = workbook.getWorksheet('Import');
  sheet.getRow(5).getCell(1).value = '0003';
  sheet.getRow(5).getCell(2).value = 'নতুন কর্মচারী';

  return workbook.xlsx.writeBuffer().then(buffer => {
    assert.deepEqual(readWorkbookRows(Buffer.from(buffer), ['emp_code', 'name']), [{
      rowNumber: 5,
      values: { emp_code: '0003', name: 'নতুন কর্মচারী' }
    }]);
  });
});

test('both shared import templates keep required columns and sample data separate', async () => {
  for (const [fields, options] of [
    [employeeImportFields, employeeTemplateOptions],
    [loanImportFields, loanTemplateOptions]
  ]) {
    const workbook = buildTemplateWorkbook(fields, options);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const requiredHeaders = fields.filter(field => field.required).map(field => field.key);
    const importedRows = readWorkbookRows(buffer, requiredHeaders);
    const sourceTypeColumn = fields.findIndex(field => field.key === 'loan_source_type') + 1;

    assert.deepEqual(importedRows, []);
    assert.equal(workbook.worksheets[0].getCell(4, 1).value, fields[0].key);
    assert.equal(workbook.worksheets[0].views[0].state, 'frozen');
    assert.ok(workbook.worksheets[1]);
    assert.ok(workbook.worksheets[2]);
    if (sourceTypeColumn > 0) {
      assert.equal(workbook.worksheets[0].getCell(5, sourceTypeColumn).dataValidation.type, 'list');
    }
  }
});
