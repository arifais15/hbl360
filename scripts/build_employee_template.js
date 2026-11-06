const { buildImportTemplates } = require('./build_import_templates');

buildImportTemplates().catch(error => {
  console.error('Excel import template build failed:', error);
  process.exitCode = 1;
});
