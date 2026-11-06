const fs = require('fs');
const path = require('path');
const { buildTemplateWorkbook } = require('../services/excelImportService');
const {
  employeeImportFields,
  employeeTemplateOptions,
  loanImportFields,
  loanTemplateOptions
} = require('../services/importTemplateDefinitions');

async function buildImportTemplates() {
  const targetDirectory = path.resolve(__dirname, '../public/templates');
  fs.mkdirSync(targetDirectory, { recursive: true });

  const templates = [
    [employeeImportFields, employeeTemplateOptions],
    [loanImportFields, loanTemplateOptions]
  ];
  for (const [fields, options] of templates) {
    const outputPath = path.join(targetDirectory, options.filename);
    const workbook = buildTemplateWorkbook(fields, options);
    await workbook.xlsx.writeFile(outputPath);
    console.log(`Updated ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
  }
}

if (require.main === module) {
  buildImportTemplates().catch(error => {
    console.error('Excel import template build failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { buildImportTemplates };
