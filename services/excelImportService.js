const XLSX = require('xlsx');
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
    blankrows: false
  });
  if (!values.length) {
    throw invalidWorkbook('Excel ফাইলে header row পাওয়া যায়নি।');
  }

  const headers = values[0].map(value => String(value).trim().toLowerCase());
  const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));
  if (missingHeaders.length) {
    throw invalidWorkbook(`Template-এর প্রয়োজনীয় কলাম নেই: ${missingHeaders.join(', ')}`);
  }

  return values.slice(1).map((cells, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? '']))
  })).filter(row => Object.values(row.values).some(value => String(value).trim() !== ''));
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

function downloadTemplate(res, filename, fields) {
  const workbook = XLSX.utils.book_new();
  const inputSheet = XLSX.utils.aoa_to_sheet([fields.map(field => field.key)]);
  inputSheet['!cols'] = fields.map(field => ({ wch: Math.max(18, field.key.length + 2) }));
  XLSX.utils.book_append_sheet(workbook, inputSheet, 'Import');

  const instructions = [
    ['কলাম', 'আবশ্যক', 'বিবরণ'],
    ...fields.map(field => [field.key, field.required ? 'হ্যাঁ' : 'না', field.description])
  ];
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
  instructionSheet['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 75 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Instructions');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

module.exports = {
  cellText,
  downloadTemplate,
  parseAmount,
  parseExcelDate,
  readWorkbookRows,
  uploadWorkbook
};
