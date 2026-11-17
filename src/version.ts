import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// package.json is the single source of truth for the server version.
// The same relative path works from src/ (type stripping) and dist/ (compiled).
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };

export const VERSION: string = manifest.version;
