# MCP Database Doctor: product facts

Sources: `README.md`, `package.json`, `server.json`, `src/`. Update this file when those change.

## What it is

An offline PostgreSQL diagnostics MCP server for AI coding agents. It reviews SQL text, migrations and `EXPLAIN (FORMAT JSON)` plans that the caller supplies, using heuristic static analysis. Package `mcp-database-doctor`, MCP name `io.github.petrovicistefan/mcp-database-doctor`, stdio transport, MIT licensed.

## What it is NOT

- Not a PostgreSQL parser and not proof that SQL is safe. No finding does not authorize a production migration.
- Not connected to any database: no connection, no credentials, no SQL execution, no `EXPLAIN ANALYZE`.
- Not an auto-fixer: it returns recommendations and never applies DDL.
- Not live database health monitoring (`health_report` aggregates supplied artifacts only).
- Not for other databases (MySQL, SQL Server, Oracle and others are untested).

## Users

AI coding agents and the developers who run them (Cursor, Claude Code, Claude Desktop, VS Code and other MCP clients) who want to check migrations, queries and plans before shipping.

## Tools (all read-only and idempotent)

| Tool | Input | Output |
|------|-------|--------|
| `analyze_query` | `sql` | Query anti-pattern findings (code, severity, message, recommendation, statement number) |
| `check_migration` | `sql` | Destructive DDL, locking and rewrite risks, transaction conflicts, constraint validation issues |
| `suggest_indexes` | `sql`, optional `existingIndexes` | Conservative index candidates; require EXPLAIN validation |
| `explain_plan` | `plan` (JSON string) | Large sequential scans, row estimate errors, sort spills, high loop counts |
| `health_report` | optional `queries`, `migrations`, `plans` | Aggregate review of supplied artifacts |

## Runtime modes

- **Local stdio MCP server** (`dist/server.js`, the `mcp-database-doctor` bin): offline, no accounts, no telemetry.
- **Hosted HTTP path** (`npm run start:hosted`, `src/hosted.ts`): opt-in. Endpoints `GET /health` and `/v1/analyze-query`, `/v1/check-migration`, `/v1/suggest-indexes`, `/v1/explain-plan`, `/v1/health-report`. It reserves quota against a control plane (`CONTROL_PLANE_URL`); SQL and plans are not sent to the control plane.

## Pricing

Per the README: the local tools are free with no usage limits. A Pro tier (history tracking, CI policies, hosted HTTP API, control-plane quotas for the hosted path) and a Team tier (shared migration policies, centralized reports, fleet-wide analysis) are listed as planned and opt-in. No prices are published.

## Known limitations

- Heuristic analysis; complex CTEs, nested scopes and unusual DDL can produce false positives or missed findings.
- No schema metadata: it cannot verify columns, types or existing indexes.
- Index suggestions are conservative: one unquoted table, no joins or subqueries, no composite optimization.
- SQL inside stored procedure bodies, `DO` blocks and dynamic strings is not inspected.
- Cannot measure real query time, lock duration or plan cost.
- PostgreSQL-first only.

## Requirements

Node.js >= 22.18.0. Runtime dependencies: `@modelcontextprotocol/sdk`, `zod`.
