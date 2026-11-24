// Prints integrity hashes (Subresource Integrity, SHA-384) for the Firebase files src/ai.js loads from
// Google's CDN, as an import map for index.html. With it, Chrome refuses to run those files if their
// contents ever change, so a tampered CDN file can't run on our page. Run: node tools/sri.mjs
// Re-run whenever the Firebase version in src/ai.js changes.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ai = readFileSync(new URL('../src/ai.js', import.meta.url), 'utf8');
const urls = [...new Set(ai.match(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/[\w-]+\.js/g) ?? [])];
if (urls.length === 0) throw new Error('No Firebase CDN imports found in src/ai.js');

const integrity = {};
for (const url of urls) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  integrity[url] = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}
console.log('Paste this into index.html, inside <head>, BEFORE the src/app.js script:\n');
console.log(`<script type="importmap">\n${JSON.stringify({ integrity }, null, 2)}\n</script>`);
