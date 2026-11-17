import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/version.ts';

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('package.json, server.json and the runtime VERSION agree', () => {
  const pkg = readJson('../package.json');
  const server = readJson('../server.json');
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  assert.equal(server.version, pkg.version, 'server.json top-level version');
  assert.ok(server.packages.length > 0);
  for (const entry of server.packages) assert.equal(entry.version, pkg.version, 'server.json packages[].version');
  assert.equal(VERSION, pkg.version, 'runtime VERSION');
});
