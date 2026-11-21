import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { contentTypeFor, resolveSafePath } from '../tools/serve.js';

const root = resolve('/project');

test('normal paths map to files inside the root', () => {
  assert.equal(resolveSafePath(root, '/dev/spike.html'), join(root, 'dev', 'spike.html'));
  assert.equal(resolveSafePath(root, '/'), join(root, 'index.html'));
  assert.equal(resolveSafePath(root, '/src/ai.js?v=2'), join(root, 'src', 'ai.js'));
});

test('paths that try to leave the root are refused', () => {
  assert.equal(resolveSafePath(root, '/../secret.txt'), null);
  assert.equal(resolveSafePath(root, '/dev/../../secret.txt'), null);
  assert.equal(resolveSafePath(root, '/%2e%2e/secret.txt'), null);
  assert.equal(resolveSafePath(root, '/bad%zzencoding'), null);
  assert.equal(resolveSafePath(root, '/a%00b'), null);
});

test('JavaScript is served with a JavaScript type, so modules load', () => {
  assert.match(contentTypeFor('src/ai.js'), /^text\/javascript/);
  assert.match(contentTypeFor('dev/spike.html'), /^text\/html/);
  assert.equal(contentTypeFor('sample/application-michigan.pdf'), 'application/pdf');
  assert.equal(contentTypeFor('weird.xyz'), 'application/octet-stream');
});
