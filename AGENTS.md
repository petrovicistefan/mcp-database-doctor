# AGENTS.md

Hard rules for anyone (human or AI agent) changing this repo. Each rule is enforced by `npm run check:rules` (`scripts/check-rules.mjs`), which is part of `prepublishOnly`. Do not weaken a check to make a change pass.

## Rules

1. **Version sync.** `package.json` `version` must equal `server.json` `version` and every `server.json` `packages[].version`. Bump all of them together.
2. **One version source.** `serverInfo.version` comes from `package.json` through `src/version.ts` (`VERSION`). Never write the version as a string literal in `src`.
3. **Local-first.** The stdio MCP server runs fully offline. Only the opt-in hosted path (`src/hosted.ts`, `src/control-plane-client.ts`) may use the network. No other file may use `fetch`, `http`/`https`, `net`, WebSocket or similar.
4. **No telemetry.** No analytics, tracking or crash-reporting dependencies or endpoints, and nothing is sent anywhere by default.
5. **No secrets or user data in logs.** SQL, EXPLAIN plans, request bodies, headers, API keys and tokens must never be logged. `src/server.ts` is the stdio protocol channel and must not use `console.*`. `console.log` elsewhere may only print a constant string.
6. **Docs stay in step.** `AGENTS.md`, `docs/PRODUCT.md` and `CHANGELOG.md` must exist, and `CHANGELOG.md` needs an `Unreleased` or current-version heading.
7. **Release scripts exist.** `package.json` keeps `check`, `check:rules`, `test`, `test:integration` and a `prepublishOnly` that runs them.

## Commands

```bash
npm run check             # tsc --noEmit
npm run check:rules       # the AGENTS.md rules above
npm test                  # unit tests (includes the version test)
npm run build
npm run test:integration  # stdio initialize + tools/list + tool calls against dist/ (run build first)
```

## Do not

- Publish to npm or the MCP Registry from a working branch; releases go through a `v*.*.*` tag and `.github/workflows/release.yml`.
- Execute SQL or connect to a database. The server only analyzes text it is given.
