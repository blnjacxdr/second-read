// Source-code guards for the privacy rules. They read the files as text, so
// they catch a rule being broken even in code no other test runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
const srcFiles = filesUnder(join(root, 'src')).filter((f) => /\.(js|html)$/.test(f));

test('no "prefer" inference mode anywhere in src/ (both can silently use the cloud)', () => {
  for (const file of srcFiles) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /InferenceMode\.PREFER_|['"]prefer_(on_device|in_cloud)['"]/, file);
  }
});

test('the App Check debug token is only ever set in dev/', () => {
  for (const file of srcFiles) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /FIREBASE_APPCHECK_DEBUG_TOKEN\s*=/, file);
  }
});

test('Firebase AI Logic is only imported in src/ai.js', () => {
  for (const file of srcFiles) {
    if (file.endsWith(join('src', 'ai.js'))) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /firebase-ai\.js|from ['"]firebase\/ai['"]/, file);
  }
});

test('the PDF reader loads pdf.js from the repo, never from another website', () => {
  const text = readFileSync(join(root, 'src', 'pdf.js'), 'utf8');
  assert.match(text, /from '\.\.\/vendor\/pdfjs\/pdf\.min\.mjs'/);
  assert.doesNotMatch(text, /https?:\/\//);
});

// Deploy guard: the dev pages (they carry the App Check debug setup), the held-out test set, the tests,
// tools and docs must never be served by Firebase Hosting.
test('Firebase Hosting never serves dev/, eval/, test/, tools/, docs/ or private/', async () => {
  const { readFileSync } = await import('node:fs');
  const hosting = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).hosting;
  for (const dir of ['dev/**', 'eval/**', 'test/**', 'tools/**', 'docs/**', 'private/**', '**/node_modules/**', '**/.*']) {
    assert.ok(hosting.ignore.includes(dir), `firebase.json hosting.ignore is missing ${dir}`);
  }
  const csp = hosting.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
});

// Links from a model's response become clickable only if they are https.
test('only https source links are allowed', async () => {
  const { safeLinkUrl } = await import('../src/core/grounding.js');
  assert.equal(safeLinkUrl('https://www.omsi.edu/about'), 'https://www.omsi.edu/about');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'http://example.com', 'vbscript:x', '', null, undefined, 'not a url']) {
    assert.equal(safeLinkUrl(bad), null, String(bad));
  }
});

// The app draws file and model text with textContent only. Raw HTML is allowed in exactly one place:
// Google's search suggestions, which Google requires us to show as sent. They go into a sandboxed iframe
// (no scripts, no same-origin access), so nothing in them can touch the page.
test('src/ never writes HTML except the reviewed places', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../src', import.meta.url).pathname;
  const files = [];
  const walk = (dir) => readdirSync(dir).forEach((f) => { const p = join(dir, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); });
  walk(root);
  const allowed = [
    /chips\.srcdoc = suggestionsPage\(answer\.searchSuggestionsHtml\);/,
  ];
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/innerHTML|outerHTML|insertAdjacentHTML|srcdoc|document\.write|\beval\(|new Function\(/.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        assert.ok(allowed.some((re) => re.test(line)), `${file}:${i + 1} writes HTML or runs code: ${line.trim()}`);
      }
    });
  }
});

// Replay protection: the AI service must ask for single-use App Check tokens.
test('src/ai.js uses single-use App Check tokens (replay protection)', async () => {
  const { readFileSync } = await import('node:fs');
  const ai = readFileSync(new URL('../src/ai.js', import.meta.url), 'utf8');
  assert.match(ai, /getAI\(app, \{[^}]*useLimitedUseAppCheckTokens: true/);
});

// The search suggestions frame: sandboxed with no scripts and no same-origin access, set before it's filled.
test('the Google suggestions frame is sandboxed without scripts or same-origin', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const sandbox = app.match(/chips\.setAttribute\('sandbox', '([^']*)'\)/);
  assert.ok(sandbox, 'the frame gets a sandbox attribute');
  assert.doesNotMatch(sandbox[1], /allow-scripts|allow-same-origin/);
  assert.ok(app.indexOf("chips.setAttribute('sandbox'") < app.indexOf('chips.srcdoc ='), 'sandbox is set before content');
});
