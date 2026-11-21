// Reads a PDF file in the browser and returns its rows of text, with position and boldness.
// Uses the copy of pdf.js in vendor/ (no CDN). The file never leaves the
// computer: it's read from the user's disk into memory and parsed right here.

import { getDocument, GlobalWorkerOptions } from '../vendor/pdfjs/pdf.min.mjs';
import { toPlainItems, buildRows } from './core/pdf-lines.js';

// pdf.js does the heavy parsing in a "worker", a background thread, so the page stays responsive.
GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/**
 * @param {File} file  from an <input type="file">
 * @returns {Promise<{ pageCount: number, rows: ReturnType<typeof buildRows> }>}  page chrome removed
 */
export async function readPdfRows(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(toPlainItems(content.items));
    }
    return { pageCount: doc.numPages, rows: buildRows(pages) };
  } finally {
    await task.destroy(); // free the memory and the background worker pdf.js used
  }
}
