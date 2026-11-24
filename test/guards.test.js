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

// "Prefer" modes can send a prompt to the cloud on their own. PREFER_IN_CLOUD is never used. PREFER_ON_DEVICE is the
// consented fallback: allowed in exactly one function in src/ai.js, which app.js calls only after the counselor's yes.
test('"prefer" inference modes only in the consented fallback', () => {
  for (const file of srcFiles) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /InferenceMode\.PREFER_IN_CLOUD|['"]prefer_in_cloud['"]/, file);
    if (file.endsWith(join('src', 'ai.js'))) continue;
    assert.doesNotMatch(text, /InferenceMode\.PREFER_|['"]prefer_on_device['"]/, file);
  }
  // Windows checkouts use \r\n line endings; normalize so the function's end is found on every system.
  const ai = readFileSync(join(root, 'src', 'ai.js'), 'utf8').replace(/\r\n/g, '\n');
  const uses = [...ai.matchAll(/InferenceMode\.PREFER_ON_DEVICE/g)].map((m) => m.index);
  const fn = ai.indexOf('export function createConsentedHybridModels(');
  const fnEnd = ai.indexOf('\n}\n', fn);
  assert.equal(uses.length, 1, 'PREFER_ON_DEVICE appears exactly once');
  assert.ok(fn > 0 && uses[0] > fn && uses[0] < fnEnd, 'and only inside createConsentedHybridModels');
  const app = readFileSync(join(root, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const calls = app.split('\n').filter((line) => line.includes('createConsentedHybridModels('));
  assert.ok(calls.length >= 1, 'app.js builds the hybrid models somewhere');
  for (const line of calls) assert.match(line, /cloudConsent === true/, `built without checking consent: ${line.trim()}`);
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
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../src', import.meta.url)); // .pathname breaks on Windows ("/D:/...")
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
