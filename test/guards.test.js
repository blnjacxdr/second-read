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
