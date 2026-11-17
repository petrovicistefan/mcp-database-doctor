#!/usr/bin/env node
// Automated checks for the hard rules in AGENTS.md. Exit code 1 on any violation.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- Per-repo configuration (the only part that differs between the MCP repos) ----
const CONFIG = {
  srcExt: '.ts',
  // Module that reads package.json and exports VERSION.
  versionModule: 'src/version.ts',
  // Files that build serverInfo / McpServer and must take the version from versionModule.
  serverEntries: ['src/server.ts'],
  // Files that speak the MCP protocol on stdout: they must not use console.*.
  stdioFiles: ['src/server.ts'],
  // Files that may use the network (the opt-in hosted path only).
  networkFiles: ['src/hosted.ts', 'src/control-plane-client.ts'],
  // Files whose console.log output is the intended CLI result.
  cliOutputFiles: [],
};
// -----------------------------------------------------------------------------------

const root = fileURLToPath(new URL('..', import.meta.url));
const errors = [];
const fail = (rule, message) => errors.push(`[${rule}] ${message}`);
const readText = path => readFileSync(join(root, path), 'utf8');
const readJson = path => JSON.parse(readText(path));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith(CONFIG.srcExt)) out.push(rel);
  }
  return out;
}

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const stripStrings = text => text.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');

const pkg = readJson('package.json');
const server = readJson('server.json');
const sources = walk('src').map(file => ({ file, text: readText(file) }));

// 1. version sync: package.json == server.json version == server.json packages[*].version
if (!pkg.version) fail('version-sync', 'package.json has no version');
if (server.version !== pkg.version) fail('version-sync', `server.json version ${server.version} !== package.json ${pkg.version}`);
if (!Array.isArray(server.packages) || server.packages.length === 0) fail('version-sync', 'server.json has no packages[]');
for (const [i, entry] of (server.packages ?? []).entries()) {
  if (entry.version !== pkg.version) fail('version-sync', `server.json packages[${i}].version ${entry.version} !== package.json ${pkg.version}`);
}

// 2. package.json is the only version source for serverInfo
if (!existsSync(join(root, CONFIG.versionModule))) fail('version-source', `${CONFIG.versionModule} is missing`);
else {
  const text = stripComments(readText(CONFIG.versionModule));
  if (!/package\.json/.test(text) || !/readFileSync|createRequire/.test(text) || !/export\s+const\s+VERSION\b/.test(text)) {
    fail('version-source', `${CONFIG.versionModule} must read package.json and export VERSION`);
  }
}
for (const entry of CONFIG.serverEntries) {
  const text = stripComments(readText(entry));
  if (!/from\s+['"]\.\/version\.(?:js|ts)['"]/.test(text) || !/\bversion\s*:\s*VERSION\b/.test(text)) {
    fail('version-source', `${entry} must import VERSION from ./version and use it for serverInfo`);
  }
}
for (const { file, text } of sources) {
  const code = stripComments(text);
  if (/\bversion\s*:\s*['"`]\d+\.\d+\.\d+/.test(code)) fail('hardcoded-version', `${file} has a hardcoded version literal`);
  if (pkg.version && (code.includes(`'${pkg.version}'`) || code.includes(`"${pkg.version}"`))) {
    fail('hardcoded-version', `${file} contains the package version "${pkg.version}" as a string literal`);
  }
}

// 3. required project docs and release scripts
for (const doc of ['AGENTS.md', 'docs/PRODUCT.md', 'CHANGELOG.md']) {
  if (!existsSync(join(root, doc))) fail('docs', `${doc} is missing`);
}
if (existsSync(join(root, 'CHANGELOG.md'))) {
  const changelog = readText('CHANGELOG.md');
  const escaped = pkg.version.replace(/\./g, '\\.');
  if (!new RegExp(`^##\\s+(?:Unreleased|\\[?${escaped}\\]?)\\b`, 'mi').test(changelog)) {
    fail('docs', `CHANGELOG.md has no "Unreleased" or "${pkg.version}" heading`);
  }
}
for (const script of ['check', 'check:rules', 'test', 'test:integration', 'prepublishOnly']) {
  if (!pkg.scripts?.[script]) fail('scripts', `package.json is missing the "${script}" script`);
}
for (const part of ['check:rules', 'test']) {
  if (pkg.scripts?.prepublishOnly && !pkg.scripts.prepublishOnly.includes(part)) fail('scripts', `prepublishOnly does not run "${part}"`);
}

// 4. no telemetry, and local files stay offline
const TELEMETRY = /posthog|mixpanel|segment\.(?:io|com)|@segment|amplitude|sentry|datadog|newrelic|applicationinsights|google-analytics|googletagmanager|plausible|hotjar|rudderstack|logrocket|bugsnag|telemetry|analytics/i;
const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies });
for (const dep of allDeps) if (TELEMETRY.test(dep)) fail('no-telemetry', `dependency "${dep}" looks like telemetry/analytics`);
const NETWORK = /\bfetch\s*\(|from\s+['"](?:node:)?(?:https?|net|tls|dgram|http2)['"]|require\(\s*['"](?:node:)?(?:https?|net|tls|dgram|http2)['"]\s*\)|\bXMLHttpRequest\b|\bWebSocket\b/;
for (const { file, text } of sources) {
  const code = stripComments(text);
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    if (TELEMETRY.test(stripStrings(line)) || /https?:\/\/[^'"`\s]*(?:posthog|mixpanel|segment|amplitude|sentry|datadog|google-analytics)/i.test(line)) {
      fail('no-telemetry', `${file}:${i + 1} references telemetry/analytics`);
    }
  });
  if (!CONFIG.networkFiles.includes(file) && NETWORK.test(code)) {
    fail('local-first', `${file} uses the network but is not an opt-in hosted file (${CONFIG.networkFiles.join(', ')})`);
  }
}

// 5. no secrets / user data in logs
function callArguments(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return text.slice(openIndex + 1, i);
  }
  return text.slice(openIndex + 1);
}
const SENSITIVE = /secret|token|api[_-]?key|apikey|password|passwd|authorization|credential|header|body|process\.env|\breq\b|\brequest\b|\bargs?\b|\binput\b|\bsql\b|\bplan\b|payload|\brecords?\b|\bspec\b/i;
for (const { file, text } of sources) {
  const code = stripComments(text);
  for (const match of code.matchAll(/\bconsole\.(\w+)\s*\(/g)) {
    const line = code.slice(0, match.index).split('\n').length;
    const method = match[1];
    const args = callArguments(code, match.index + match[0].length - 1);
    if (CONFIG.stdioFiles.includes(file)) fail('no-secrets-in-logs', `${file}:${line} console.${method} in a stdio protocol file`);
    else if (['log', 'info', 'debug'].includes(method) && !CONFIG.cliOutputFiles.includes(file) && !/^\s*(?:'[^'\n]*'|"[^"\n]*")\s*$/.test(args)) {
      fail('no-secrets-in-logs', `${file}:${line} console.${method} must only print a constant string`);
    } else if (!CONFIG.cliOutputFiles.includes(file) && SENSITIVE.test(stripStrings(args))) {
      fail('no-secrets-in-logs', `${file}:${line} console.${method} arguments reference possibly sensitive data: ${args.trim().slice(0, 80)}`);
    }
  }
  if (/process\.stderr\.write\s*\(/.test(code) && !CONFIG.cliOutputFiles.includes(file)) fail('no-secrets-in-logs', `${file} writes to stderr directly; use a reviewed log call`);
}

if (errors.length) {
  console.error(`check:rules failed (${errors.length}):`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`check:rules passed (${relative(process.cwd(), root) || '.'}, version ${pkg.version})`);
