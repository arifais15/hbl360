const fs = require('node:fs');
const path = require('node:path');

const projectDirectory = path.resolve(__dirname, '..');
const sourcePublicDirectory = path.resolve(projectDirectory, '..', 'public');
const outputDirectory = path.join(projectDirectory, 'public');

if (!fs.existsSync(path.join(sourcePublicDirectory, 'index.html'))) {
  throw new Error(`Offline UI source was not found: ${sourcePublicDirectory}`);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.cpSync(sourcePublicDirectory, outputDirectory, { recursive: true });

const apiClientPath = path.join(outputDirectory, 'js', 'api.js');
let apiClient = fs.readFileSync(apiClientPath, 'utf8');
apiClient = apiClient.replace('const API = {', 'window.CLOUD_EDITION = true;\n\nconst API = {');
apiClient = apiClient.split("if (options.method === undefined || options.method === 'GET') {")
  .join("if ((options.method === undefined || options.method === 'GET') && !window.CLOUD_EDITION) {");
fs.writeFileSync(apiClientPath, apiClient);

const htmlPath = path.join(outputDirectory, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(
  '<script src="/js/app.js?v=2.3.53"></script>',
  '<script src="/js/app.js?v=2.3.53"></script>\n  <script src="/js/cloud-sync.js"></script>'
);
fs.writeFileSync(htmlPath, html);
fs.copyFileSync(path.join(projectDirectory, 'client', 'cloud-sync.js'), path.join(outputDirectory, 'js', 'cloud-sync.js'));

console.log(`Built cloud static assets from ${sourcePublicDirectory}`);
