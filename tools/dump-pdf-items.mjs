// Saves the raw text pieces pdf.js reads from a PDF, as JSON, so tests can run
// the line and section logic without pdf.js (whose browser build needs a browser).
//
// Usage (needs the pdfjs-dist package, same version as vendor/pdfjs):
//   npm install --no-save pdfjs-dist@6.5.438
//   node tools/dump-pdf-items.mjs sample/application-michigan.pdf test/fixtures/michigan-items.json
//
// Only ever run this on the fictional sample PDFs. Never save a real application.
import { readFileSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { toPlainItems } from '../src/core/pdf-lines.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node tools/dump-pdf-items.mjs <input.pdf> <output.json>');
  process.exit(1);
}

const doc = await getDocument({ data: new Uint8Array(readFileSync(input)), verbosity: 0 }).promise;
const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const content = await (await doc.getPage(n)).getTextContent();
  pages.push(toPlainItems(content.items));
}
writeFileSync(output, JSON.stringify({ source: input, pages }, null, 1) + '\n');
console.log(`wrote ${output}: ${pages.length} pages`);
