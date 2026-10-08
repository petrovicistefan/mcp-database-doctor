---
name: mcp-add-tool
description: Adds a new MCP tool to an existing local tool server (schema, handler, tests, README). Use when implementing tools/list entries, extending analysis APIs, or wiring tools/call handlers.
---

# Add a Tool to an MCP Server

## Steps

1. **Core function** in the analysis module (no I/O to stdout). Pure inputs → report object.
2. **Register** in the server `tools` array:
   - `name`: snake_case
   - `description`: accurate scope + limits (what it does *not* do)
   - `inputSchema`: JSON Schema object; prefer `required` + `additionalProperties: false`
3. **Handler** in `tools/call`: map args → core; on success return JSON text content; on known failure set `isError: true` with clear message.
4. **Tests** for the core function (happy path, limits, invalid input).
5. **README** tools table + example agent prompt.

## Report shape (preferred)

Stable fields agents can rely on, e.g. `code`, `severity`, `message`, `recommendation`, plus explicit coverage/limit notes. Absence of findings ≠ “safe”.

## Checklist

- [ ] No secrets in examples
- [ ] Size/count limits documented and enforced where relevant
- [ ] Description free of prompt-injection / override language
- [ ] `npm test` / `npm run check` pass
- [ ] Commercial boundary unchanged (no local paid lock)
