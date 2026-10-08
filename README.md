# MCP Database Doctor

Offline PostgreSQL diagnostics for AI coding agents. Review SQL, risky migrations, candidate indexes and supplied EXPLAIN JSON plans without database credentials or executing statements.

**Status: 0.1.0 MVP / not published to npm.** Static rules are heuristic: `no_rules_triggered` does not mean safe, performant or valid PostgreSQL. No telemetry, remote analysis, credentials or automatic fixes.

## Tools

| Tool | Input | Output |
| --- | --- | --- |
| `analyze_query` | `sql` | SQL anti-patterns with severity and recommendations |
| `check_migration` | `sql` | Destructive DDL, index locking, constraints, rewrite and transaction risks |
| `suggest_indexes` | `sql`, optional `existingIndexes: [{table, columns}]` | Conservative DDL candidates; not applied |
| `explain_plan` | `plan` as a JSON string | Large sequential scans, row estimate errors, sort spills, high loops |
| `health_report` | optional `queries`, `migrations`, `plans` arrays; at least one required | Aggregate review of supplied artifacts only |

Reports include `code`, `severity`, `message`, `recommendation`, and statement numbers for SQL. No synthetic database health score.

## Development

Node.js >=22.18 (Node 24 recommended).

```sh
npm install
npm run check
npm test
npm run build
npm run test:integration
npm pack --dry-run
```

Core tests run without installed dependencies using Node's native TypeScript stripping. Vitest integration tests exercise the official MCP client over stdio after build. CI runs both. Generate and commit a package-lock.json after the first successful dependency installation; current checkout does not include one because npm access was blocked in the implementation environment.

## Claude Code / Cursor

Build locally first. Copy `examples/mcp.json` into your client's MCP configuration and replace the absolute checkout path:

```json
{
  "mcpServers": {
    "database-doctor": {
      "command": "node",
      "args": ["/absolute/path/mcp-database-doctor/dist/server.js"]
    }
  }
}
```

Claude Code CLI alternative:

```sh
claude mcp add database-doctor -- node /absolute/path/mcp-database-doctor/dist/server.js
```

After npm publication the expected launch command is `npx -y mcp-database-doctor`; do not use it before publication. Check npm name availability before releasing.

Suggested agent instruction: "Before proposing database changes, call check_migration. Review slow queries with analyze_query and supplied EXPLAIN JSON. Treat index DDL as candidates requiring workload validation."

## Examples

`check_migration({"sql":"BEGIN; CREATE INDEX CONCURRENTLY ON users(email); COMMIT;"})` identifies an invalid transaction context.

`analyze_query({"sql":"SELECT * FROM users OFFSET 50000"})` flags projection and deep pagination.

`explain_plan({"plan":"[{\"Plan\":{\"Node Type\":\"Seq Scan\",\"Plan Rows\":20000}}]"})` flags a scan for review; it does not claim an index is necessarily better.

For a real database, obtain plans yourself on a safe test environment: `EXPLAIN (FORMAT JSON) SELECT ...`. EXPLAIN ANALYZE executes the statement; this server never runs it.

## Limits and interpretation

- PostgreSQL-first, not a full SQL parser. Comments and string/dollar literals are masked. Quoted identifiers are masked to avoid keyword confusion.
- SQL inside stored procedures, DO blocks and dynamic strings is not analyzed. Complex CTEs, nested scopes, aliases, quoted/schema names and unusual DDL can produce false positives or missed findings.
- Index inference intentionally supports one unquoted table without joins/subqueries. No schema metadata, statistics, foreign-key index analysis or composite-index optimization. Existing indexes only suppress candidates when their supplied leading column matches; partial/expression indexes need manual review.
- Migration checks assume the supplied script defines transaction boundaries. If a migration framework wraps scripts externally, provide its BEGIN/COMMIT context when checking concurrent indexes.
- 100000 characters per SQL, 1 MB per plan string, 100 artifacts per report, 10000 plan nodes. These are analysis limits, not a substitute for host transport limits.
- Findings are review prompts. Absence of a finding is not authorization to run a migration.

## Commercial roadmap

Free: local query/migration/plan analysis. Pro later: history, before/after comparisons, CI policies and advanced recommendations. Team later: shared policies and centralized reports. No billing or quota enforcement is implemented in 0.1.0; local-only free usage cannot provide a trustworthy paid quota. Hosted features are the proposed monetization boundary.

## Validation status

- 52 core tests passed in the implementation environment.
- Typecheck/build/MCP stdio integration: configured, not run locally (npm registry returned HTTP 403).
- Real PostgreSQL and two actual AI hosts: pending; configuration files do not constitute host integration validation.

## References

- https://ts.sdk.modelcontextprotocol.io/server
- https://www.postgresql.org/docs/current/sql-createindex.html
- https://www.postgresql.org/docs/current/using-explain.html

MIT license.
