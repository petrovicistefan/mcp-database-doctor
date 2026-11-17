## Unreleased

## 0.1.3

- `serverInfo.version` now comes from `package.json` through `src/version.ts` instead of a string literal.
- Added `scripts/check-rules.mjs` (`npm run check:rules`): fails on `package.json`/`server.json` version drift, hardcoded version literals, network use outside the hosted path, telemetry references, and logging of possibly sensitive data.
- Added `test/version.test.ts` (package.json == server.json == runtime version); the stdio integration test also asserts the reported server version.
- `prepublishOnly` now runs `check:rules`.
- Added `AGENTS.md` and `docs/PRODUCT.md`.

## 0.1.2 (2026-10-19)

- **Documentation-only patch release**: README rewritten for GitHub discoverability, conversions and stars
- Added demo VHS tape file (`docs/demo.tape`) showing a dangerous migration being caught
- Restructured README with clear hook, badges, quickstart at top, comparison table, and use cases
- Added "More MCP Servers by the Author" section linking the full MCP suite
- No code changes, no API changes

## 0.1.1 (2026-10-08)

- Re-release with the version reported by the server aligned to the package version. No functional changes compared to 0.1.0.

## 0.1.0 (2026-10-08)

- First public release (MVP): published on npm, the official MCP Registry and the petrovicistefan MCP marketplace.
