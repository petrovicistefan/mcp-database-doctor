import { chmodSync } from 'node:fs';
chmodSync(new URL('../dist/server.js', import.meta.url), 0o755);
