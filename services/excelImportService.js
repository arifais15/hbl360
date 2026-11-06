const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!/\.xlsx$/i.test(file.originalname || '')) {
      return callback(new Error('শুধুমাত্র .xlsx Excel ফাইল আপলোড করুন।'));
    }
    callback(null, true);
  }
});

function invalidWorkbook(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function uploadWorkbook(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next();
  });
}

const HEADER_ALIASES = {
  // Employee headers
  'emp_code': ['emp_code', 'পে আইডি', 'আইডি কোড', 'id', 'emp code', 'code', 'employee_id', 'employee id', 'পে_আইডি'],
  'name': ['name', 'নাম', 'কর্মকর্তা/কর্মচারীর নাম', 'কর্মচারীর নাম', 'পূর্ণ নাম', 'employee name', 'full name'],
  'designation': ['designation', 'পদবী', 'পদবি', 'designation/title'],
  'department': ['department', 'বিভাগ', 'শাখা', 'dept'],
  'mobile': ['mobile', 'মোবাইল', 'মোবাইল নম্বর', 'ফোন', 'phone', 'contact'],
  'email': ['email', 'ইমেইল', 'ই-মেইল', 'mail'],
  'joining_date': ['joining_date', 'যোগদানের তারিখ', 'joining date', 'joining_dt'],
  'current_posting_pbs': ['current_posting_pbs', 'বর্তমান পদায়ন পবিস', 'বর্তমান পদায়ন', 'পদায়ন', 'posting', 'current posting', 'current_posting'],

  // Loan headers
  'loan_no': ['loan_no', 'ঋণ নং', 'ঋণ নম্বর', 'loan no', 'loan number'],
  'loan_lot_name': ['loan_lot_name', 'ঋণ লট', 'লট', 'বরাদ্দ লট', 'lot', 'loan lot'],
  'loan_source_type': ['loan_source_type', 'ঋণের ধরন', 'উৎস ধরন', 'source type', 'source_type'],
  'origin_pbs_name': ['origin_pbs_name', 'উৎস পবিস', 'উৎস পবিসের নাম', 'origin pbs', 'pbs_name'],
  'sanction_no': ['sanction_no', 'মঞ্জুরি নং', 'মঞ্জুরি নম্বর', 'sanction no'],
  'sanction_date': ['sanction_date', 'মঞ্জুরি তারিখ', 'sanction date'],
  'disbursement_date': ['disbursement_date', 'বিতরণ তারিখ', 'বিতরণের তারিখ', 'disbursement date'],
  'sanction_amount': ['sanction_amount', 'মঞ্জুরিকৃত ঋণ', 'মঞ্জুরিকৃত টাকা', 'sanction amount'],
  'disbursed_amount': ['disbursed_amount', 'বিতরণকৃত ঋণ', 'মূল ঋণ', 'disbursed amount'],
  'monthly_installment': ['monthly_installment', 'মাসিক কিস্তি', 'কিস্তি', 'installment', 'monthly installment'],
  'principal_balance': ['principal_balance', 'অবশিষ্ট আসল', 'আসল স্থিতি', 'principal balance'],
  'interest_balance': ['interest_balance', 'অবশিষ্ট সুদ', 'সুদ স্থিতি', 'interest balance'],
  'total_principal_paid': ['total_principal_paid', 'পরিশোধিত আসল', 'মোট আসল আদায়', 'principal paid'],
  'total_interest_paid': ['total_interest_paid', 'পরিশোধিত সুদ', 'মোট সুদ আদায়', 'interest paid'],
  'interest_rate': ['interest_rate', 'সুদের হার', 'interest rate', 'rate'],
  'remarks': ['remarks', 'মন্তব্য', 'নোট', 'note']
};

function mapHeaderRow(values, requiredHeaders) {
  const rawHeaders = values.map(value => String(value).trim().toLowerCase());
  const columnKeyMap = {};
  rawHeaders.forEach((rawHeader, colIdx) => {
    for (const [canonicalKey, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some(alias => alias.toLowerCase() === rawHeader)) {
        columnKeyMap[colIdx] = canonicalKey;
        break;
      }
    }
    if (!columnKeyMap[colIdx]) {
      columnKeyMap[colIdx] = rawHeader;
    }
  });
  return { columnKeyMap, missingHeaders: requiredHeaders.filter(header => !Object.values(columnKeyMap).includes(header)) };
}

function readWorkbookRows(buffer, requiredHeaders) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (error) {
    throw invalidWorkbook('Excel ফাইলটি পড়া যায়নি। সঠিক .xlsx ফাইল নির্বাচন করুন।');
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw invalidWorkbook('Excel ফাইলে কোনো worksheet পাওয়া যায়নি।');
  }

  const values = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: true,
    blankrows: true
  });
  if (!values.length) {
    throw invalidWorkbook('Excel ফাইলে header row পাওয়া যায়নি।');
  }

  const headerSearchLimit = Math.min(values.length, 12);
  let headerRowIndex = -1;
  let headerMapping = null;
  let bestMissingHeaders = requiredHeaders;
  for (let rowIndex = 0; rowIndex < headerSearchLimit; rowIndex++) {
    const mapping = mapHeaderRow(values[rowIndex], requiredHeaders);
    if (mapping.missingHeaders.length < bestMissingHeaders.length) {
      bestMissingHeaders = mapping.missingHeaders;
    }
    if (mapping.missingHeaders.length === 0) {
      headerRowIndex = rowIndex;
      headerMapping = mapping;
      break;
    }
  }
  if (headerRowIndex === -1 || !headerMapping) {
    throw invalidWorkbook(`Template-এর প্রয়োজনীয় কলাম নেই: ${bestMissingHeaders.join(', ')}`);
  }

  return values.slice(headerRowIndex + 1).map((cells, index) => {
    const rowValues = {};
    cells.forEach((cellVal, colIdx) => {
      const key = headerMapping.columnKeyMap[colIdx];
      if (key) {
        rowValues[key] = cellVal ?? '';
      }
    });
    return {
      rowNumber: headerRowIndex + index + 2,
      values: rowValues
    };
  }).filter(row => Object.values(row.values).some(value => String(value).trim() !== ''));
}

function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function parseAmount(value) {
  const digits = cellText(value)
    .replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)))
    .replace(/[,،\s]/g, '');
  if (!digits) return NaN;
  return Number(digits);
}

function parseExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return '';
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }

  const text = cellText(value).replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dayFirst = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dayFirst) {
    return `${dayFirst[3]}-${String(dayFirst[2]).padStart(2, '0')}-${String(dayFirst[1]).padStart(2, '0')}`;
  }

  return '';
}

const TEMPLATE_COLORS = {
  green: '047857',
  darkGreen: '065F46',
  paleGreen: 'ECFDF5',
  paleBlue: 'EFF6FF',
  paleGray: 'F3F6F5',
  border: 'D5E2DC',
  text: '17352B',
  white: 'FFFFFF'
};

function styleTableHeader(row) {
  row.height = 28;
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_COLORS.darkGreen } };
    cell.font = { name: 'Aptos', bold: true, color: { argb: TEMPLATE_COLORS.white }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: TEMPLATE_COLORS.green } },
      right: { style: 'thin', color: { argb: TEMPLATE_COLORS.white } }
    };
  });
}

function styleTitle(sheet, title, subtitle, columnCount) {
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.mergeCells(2, 1, 2, columnCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_COLORS.darkGreen } };
  titleCell.font = { name: 'Aptos', bold: true, color: { argb: TEMPLATE_COLORS.white }, size: 16 };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = subtitle;
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_COLORS.paleGreen } };
  subtitleCell.font = { name: 'Aptos', bold: true, color: { argb: TEMPLATE_COLORS.text }, size: 10 };
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.getRow(1).height = 32;
  sheet.getRow(2).height = 26;
}

function buildTemplateWorkbook(fields, { title, subtitle, examples = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PBS House Loan Management System';
  workbook.subject = title;
  workbook.created = new Date();
  workbook.modified = new Date();

  const importSheet = workbook.addWorksheet('Import', {
    views: [{ state: 'frozen', ySplit: 4, xSplit: 1, topLeftCell: 'B5' }]
  });
  importSheet.properties.defaultRowHeight = 22;
  styleTitle(importSheet, title, subtitle, fields.length);
  const noteRow = importSheet.getRow(3);
  noteRow.getCell(1).value = 'নির্দেশনা: সবুজ হেডারের কলাম নাম পরিবর্তন করবেন না। আবশ্যক (*) তথ্য পূরণ করে এই Import শিটটি আপলোড করুন।';
  importSheet.mergeCells(3, 1, 3, fields.length);
  noteRow.height = 24;
  noteRow.getCell(1).font = { name: 'Aptos', italic: true, color: { argb: TEMPLATE_COLORS.text }, size: 9 };
  noteRow.getCell(1).alignment = { vertical: 'middle', wrapText: true };
  const headerRow = importSheet.getRow(4);
  headerRow.values = fields.map(field => field.key);
  styleTableHeader(headerRow);
  importSheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 1004, column: fields.length } };
  importSheet.columns = fields.map(field => ({
    key: field.key,
    width: Math.min(34, Math.max(18, field.key.length + 4)),
    style: ['emp_code', 'employee_code', 'mobile', 'loan_no', 'sanction_no'].includes(field.key)
      ? { numFmt: '@' }
      : undefined
  }));
  importSheet.getColumn(1).width = Math.min(34, Math.max(18, fields[0].key.length + 4));
  importSheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const sourceTypeColumn = fields.findIndex(field => field.key === 'loan_source_type') + 1;
  if (sourceTypeColumn > 0) {
    for (let rowNumber = 5; rowNumber <= 1004; rowNumber++) {
      importSheet.getCell(rowNumber, sourceTypeColumn).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"OWN_PBS,OTHER_PBS"'],
        showErrorMessage: true,
        errorTitle: 'ঋণের উৎস ধরন',
        error: 'OWN_PBS অথবা OTHER_PBS নির্বাচন করুন।'
      };
    }
  }

  const instructionSheet = workbook.addWorksheet('নির্দেশিকা');
  styleTitle(instructionSheet, `${title} — নির্দেশিকা`, 'কলাম কী, আবশ্যকতা ও পূরণের নিয়ম', 5);
  instructionSheet.getRow(3).values = ['ক্রম', 'Column Key', 'বাংলা শিরোনাম', 'আবশ্যক', 'বিবরণ ও পূরণের নিয়ম'];
  styleTableHeader(instructionSheet.getRow(3));
  fields.forEach((field, index) => {
    const row = instructionSheet.getRow(index + 4);
    row.values = [
      index + 1,
      field.key,
      field.label || field.key,
      field.required ? 'হ্যাঁ' : 'না',
      field.description
    ];
    row.height = 34;
    row.eachCell(cell => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: index % 2 === 0 ? TEMPLATE_COLORS.white : TEMPLATE_COLORS.paleGray }
      };
      cell.font = { name: 'Aptos', color: { argb: TEMPLATE_COLORS.text }, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: TEMPLATE_COLORS.border } } };
    });
  });
  instructionSheet.columns = [{ width: 8 }, { width: 30 }, { width: 32 }, { width: 12 }, { width: 78 }];
  instructionSheet.views = [{ state: 'frozen', ySplit: 3, topLeftCell: 'A4' }];
  instructionSheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: fields.length + 3, column: 5 }
  };
  instructionSheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  if (examples.length) {
    const exampleSheet = workbook.addWorksheet('উদাহরণ (আপলোড নয়)');
    styleTitle(exampleSheet, `${title} — নমুনা`, 'এই শিটটি শুধু উদাহরণ। আমদানির জন্য Import শিট পূরণ করে আপলোড করুন।', fields.length);
    exampleSheet.getRow(3).values = fields.map(field => field.key);
    styleTableHeader(exampleSheet.getRow(3));
    examples.forEach((example, index) => {
      const row = exampleSheet.getRow(index + 4);
      row.values = fields.map(field => example[field.key] ?? '');
      row.height = 26;
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_COLORS.paleBlue } };
        cell.font = { name: 'Aptos', color: { argb: TEMPLATE_COLORS.text }, size: 10 };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: TEMPLATE_COLORS.border } } };
      });
    });
    exampleSheet.columns = fields.map(field => ({ width: Math.min(34, Math.max(18, field.key.length + 4)) }));
    exampleSheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 1, topLeftCell: 'B4' }];
    exampleSheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  return workbook;
}

async function downloadTemplate(res, filename, fields, options = {}) {
  try {
    const workbook = buildTemplateWorkbook(fields, options);
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Excel template generation error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Excel টেমপ্লেট তৈরি করা যায়নি।' });
    }
  }
}

module.exports = {
  cellText,
  buildTemplateWorkbook,
  downloadTemplate,
  parseAmount,
  parseExcelDate,
  readWorkbookRows,
  uploadWorkbook
};
